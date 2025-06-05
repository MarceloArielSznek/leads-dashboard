const db = require('../config/database');

// Parse command line arguments
const args = process.argv.slice(2);
const isLiveMode = args.includes('--live');

// Configuration
const CONFIG = {
    DRY_RUN: !isLiveMode,
    BACKUP_BEFORE_DELETE: true,
    LOG_LEVEL: 'detailed',
};

console.log('🧹 DUPLICATE CLEANUP SCRIPT (FIXED)');
console.log('===================================');
console.log(`Mode: ${CONFIG.DRY_RUN ? '🔍 DRY RUN (no actual deletions)' : '🚨 LIVE MODE (will delete duplicates)'}`);
console.log(`Backup: ${CONFIG.BACKUP_BEFORE_DELETE ? '✅ Enabled' : '❌ Disabled'}`);

const results = {
    duplicateLeads: [],
    deletedLeads: 0,
    errors: [],
    processedGroups: 0,
    skippedGroups: 0
};

if (!CONFIG.DRY_RUN) {
    console.log('\n🚨 WARNING: This will DELETE duplicate records from your database!');
    console.log('⏱️  Starting in 5 seconds... Press Ctrl+C to cancel');
    
    setTimeout(() => {
        console.log('🚀 Starting live cleanup...\n');
        runCleanup();
    }, 5000);
} else {
    console.log('\n⚠️  This is a SAFE preview mode - no data will be deleted');
    console.log('💡 To perform actual cleanup, use: node scripts/cleanup-duplicates-fixed.js --live');
    console.log('');
    runCleanup();
}

/**
 * Find duplicate leads
 */
async function findDuplicateLeads(client) {
    console.log('🔍 Searching for duplicate leads...');

    const duplicates = await client.query(`
        SELECT 
            LOWER(l.name) as lead_name_key,
            l.branch_id,
            l.final_proposal_amount,
            array_agg(
                json_build_object(
                    'id', l.id,
                    'name', l.name,
                    'created_date', l.created_date,
                    'final_proposal_amount', l.final_proposal_amount,
                    'lead_status', ls.name,
                    'salesperson', sp.name,
                    'customer', json_build_object(
                        'id', c.id,
                        'name', COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''),
                        'email', c.email_address
                    )
                ) ORDER BY l.created_date DESC
            ) as leads
        FROM leads_dashboard.lead l
        LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
        LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
        LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
        WHERE l.name IS NOT NULL
        GROUP BY LOWER(l.name), l.branch_id, l.final_proposal_amount
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
    `);

    console.log(`📄 Found ${duplicates.rows.length} duplicate groups`);
    return duplicates.rows;
}

/**
 * Choose best lead to keep
 */
function chooseBestLead(leads) {
    return leads.sort((a, b) => {
        // Priority 1: Highest proposal amount
        const amountA = parseFloat(a.final_proposal_amount) || 0;
        const amountB = parseFloat(b.final_proposal_amount) || 0;
        if (amountA !== amountB) {
            return amountB - amountA;
        }
        
        // Priority 2: Sold status
        const soldA = a.lead_status?.toLowerCase() === 'sold' ? 1 : 0;
        const soldB = b.lead_status?.toLowerCase() === 'sold' ? 1 : 0;
        if (soldA !== soldB) {
            return soldB - soldA;
        }
        
        // Priority 3: Most recent
        const dateA = new Date(a.created_date);
        const dateB = new Date(b.created_date);
        return dateB.getTime() - dateA.getTime();
    })[0];
}

/**
 * Delete one lead safely with individual transaction
 */
async function deleteLeadSafely(leadId) {
    const client = await db.pool.connect();
    
    try {
        if (!CONFIG.DRY_RUN) {
            await client.query('BEGIN');
            
            // Delete dependencies first
            await client.query('DELETE FROM leads_dashboard.lead_tag WHERE lead_id = $1', [leadId]);
            await client.query('DELETE FROM leads_dashboard.lead_group_assignment WHERE lead_id = $1', [leadId]);
            
            // Delete the lead
            await client.query('DELETE FROM leads_dashboard.lead WHERE id = $1', [leadId]);
            
            await client.query('COMMIT');
        }
        
        return { success: true };
        
    } catch (error) {
        if (!CONFIG.DRY_RUN) {
            await client.query('ROLLBACK');
        }
        return { success: false, error: error.message };
        
    } finally {
        client.release();
    }
}

/**
 * Process one duplicate group
 */
async function processDuplicateGroup(group, groupIndex, totalGroups) {
    const leads = group.leads;
    if (leads.length <= 1) {
        results.skippedGroups++;
        return;
    }

    const bestLead = chooseBestLead(leads);
    const leadsToDelete = leads.filter(l => l.id !== bestLead.id);

    console.log(`\n📋 Group ${groupIndex + 1}/${totalGroups}: "${group.lead_name_key}"`);
    console.log(`  ✅ Keeping: ID ${bestLead.id} - $${bestLead.final_proposal_amount} - ${bestLead.lead_status}`);
    
    for (const leadToDelete of leadsToDelete) {
        console.log(`  🗑️ Deleting: ID ${leadToDelete.id} - $${leadToDelete.final_proposal_amount} - ${leadToDelete.lead_status}`);
        
        const deleteResult = await deleteLeadSafely(leadToDelete.id);
        
        if (deleteResult.success) {
            results.deletedLeads++;
            console.log(`    ✅ Successfully deleted lead ${leadToDelete.id}`);
        } else {
            console.error(`    ❌ Failed to delete lead ${leadToDelete.id}: ${deleteResult.error}`);
            results.errors.push({
                type: 'lead_deletion',
                id: leadToDelete.id,
                error: deleteResult.error
            });
        }
    }
    
    results.processedGroups++;
}

/**
 * Main cleanup function
 */
async function cleanupDuplicates() {
    const client = await db.pool.connect();
    
    try {
        console.log('🚀 Starting duplicate cleanup process...\n');
        
        // Find all duplicate groups
        const duplicateGroups = await findDuplicateLeads(client);
        
        if (duplicateGroups.length === 0) {
            console.log('✨ No duplicate leads found!');
            return;
        }
        
        console.log(`\n📊 Processing ${duplicateGroups.length} duplicate groups...`);
        console.log('Each group will be processed in its own transaction for safety.\n');
        
        // Process each group individually
        for (let i = 0; i < duplicateGroups.length; i++) {
            await processDuplicateGroup(duplicateGroups[i], i, duplicateGroups.length);
            
            // Show progress every 50 groups
            if ((i + 1) % 50 === 0) {
                console.log(`\n📈 Progress: ${i + 1}/${duplicateGroups.length} groups processed`);
                console.log(`   ✅ Deleted: ${results.deletedLeads} leads`);
                console.log(`   ❌ Errors: ${results.errors.length}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Print final summary
 */
function printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 FINAL CLEANUP SUMMARY');
    console.log('='.repeat(50));
    
    console.log(`📋 Groups processed: ${results.processedGroups}`);
    console.log(`⏭️ Groups skipped: ${results.skippedGroups}`);
    console.log(`🗑️ Leads ${CONFIG.DRY_RUN ? 'that would be' : ''} deleted: ${results.deletedLeads}`);
    console.log(`❌ Errors encountered: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
        console.log('\n⚠️ FIRST 10 ERRORS:');
        results.errors.slice(0, 10).forEach((error, index) => {
            console.log(`${index + 1}. ${error.type} ID ${error.id}: ${error.error}`);
        });
        if (results.errors.length > 10) {
            console.log(`... and ${results.errors.length - 10} more errors`);
        }
    }
    
    if (CONFIG.DRY_RUN) {
        console.log('\n💡 To actually perform the cleanup, use: --live flag');
    } else {
        console.log('\n✅ Live cleanup completed!');
    }
    
    console.log('\n✨ Process complete!');
}

function runCleanup() {
    cleanupDuplicates()
        .then(() => {
            printSummary();
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Cleanup failed:', error);
            printSummary();
            process.exit(1);
        });
} 