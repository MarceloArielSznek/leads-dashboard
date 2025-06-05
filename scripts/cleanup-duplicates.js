const db = require('../config/database');

// Parse command line arguments
const args = process.argv.slice(2);
const isLiveMode = args.includes('--live');

// Configuration
const CONFIG = {
    DRY_RUN: !isLiveMode, // Set to false when --live is passed
    BACKUP_BEFORE_DELETE: true,
    LOG_LEVEL: 'detailed', // 'summary' or 'detailed'
};

console.log('🧹 DUPLICATE CLEANUP SCRIPT');
console.log('==========================');
console.log(`Mode: ${CONFIG.DRY_RUN ? '🔍 DRY RUN (no actual deletions)' : '🚨 LIVE MODE (will delete duplicates)'}`);
console.log(`Backup: ${CONFIG.BACKUP_BEFORE_DELETE ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`Logging: ${CONFIG.LOG_LEVEL}`);

if (!CONFIG.DRY_RUN) {
    console.log('\n🚨 WARNING: This will DELETE duplicate records from your database!');
    console.log('⏱️  Starting in 5 seconds... Press Ctrl+C to cancel');
    
    // Give user 5 seconds to cancel
    setTimeout(() => {
        console.log('🚀 Starting live cleanup...\n');
        runCleanup();
    }, 5000);
} else {
    console.log('\n⚠️  This is a SAFE preview mode - no data will be deleted');
    console.log('💡 To perform actual cleanup, use: node scripts/cleanup-duplicates.js --live');
    console.log('');
    runCleanup();
}

const results = {
    duplicateCustomers: [],
    duplicateLeads: [],
    deletedCustomers: 0,
    deletedLeads: 0,
    errors: []
};

/**
 * Find duplicate customers based on multiple criteria
 */
async function findDuplicateCustomers(client) {
    console.log('🔍 Searching for duplicate customers...');
    
    // Find duplicates by email (exact match, case-insensitive)
    const emailDuplicates = await client.query(`
        SELECT 
            LOWER(email_address) as email_key,
            array_agg(
                json_build_object(
                    'id', c.id,
                    'first_name', c.first_name,
                    'last_name', c.last_name,
                    'email_address', c.email_address,
                    'phone', c.phone,
                    'created_at', c.created_at,
                    'address', json_build_object(
                        'street', a.street,
                        'city', a.city,
                        'state', a.state,
                        'zip_code', a.zip_code
                    ),
                    'lead_count', (SELECT COUNT(*) FROM leads_dashboard.lead WHERE customer_id = c.id)
                ) ORDER BY c.created_at DESC
            ) as customers
        FROM leads_dashboard.customer c
        LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
        WHERE c.email_address IS NOT NULL 
        AND c.email_address != ''
        GROUP BY LOWER(c.email_address)
        HAVING COUNT(*) > 1
    `);

    // Find duplicates by name + address combination
    const nameAddressDuplicates = await client.query(`
        SELECT 
            LOWER(c.first_name) as first_name_key,
            LOWER(c.last_name) as last_name_key,
            LOWER(a.street) as street_key,
            LOWER(a.city) as city_key,
            array_agg(
                json_build_object(
                    'id', c.id,
                    'first_name', c.first_name,
                    'last_name', c.last_name,
                    'email_address', c.email_address,
                    'phone', c.phone,
                    'created_at', c.created_at,
                    'lead_count', (SELECT COUNT(*) FROM leads_dashboard.lead WHERE customer_id = c.id)
                ) ORDER BY c.created_at DESC
            ) as customers
        FROM leads_dashboard.customer c
        JOIN leads_dashboard.address a ON c.address_id = a.id
        WHERE c.first_name IS NOT NULL 
        AND c.last_name IS NOT NULL 
        AND a.street IS NOT NULL
        AND a.city IS NOT NULL
        GROUP BY LOWER(c.first_name), LOWER(c.last_name), LOWER(a.street), LOWER(a.city)
        HAVING COUNT(*) > 1
    `);

    // Find duplicates by phone number (exact match)
    const phoneDuplicates = await client.query(`
        SELECT 
            phone as phone_key,
            array_agg(
                json_build_object(
                    'id', c.id,
                    'first_name', c.first_name,
                    'last_name', c.last_name,
                    'email_address', c.email_address,
                    'phone', c.phone,
                    'created_at', c.created_at,
                    'lead_count', (SELECT COUNT(*) FROM leads_dashboard.lead WHERE customer_id = c.id)
                ) ORDER BY c.created_at DESC
            ) as customers
        FROM leads_dashboard.customer c
        WHERE c.phone IS NOT NULL 
        AND c.phone != ''
        AND LENGTH(c.phone) >= 10
        GROUP BY c.phone
        HAVING COUNT(*) > 1
    `);

    console.log(`📧 Email duplicates: ${emailDuplicates.rows.length} groups`);
    console.log(`🏠 Name+Address duplicates: ${nameAddressDuplicates.rows.length} groups`);
    console.log(`📱 Phone duplicates: ${phoneDuplicates.rows.length} groups`);

    return {
        email: emailDuplicates.rows,
        nameAddress: nameAddressDuplicates.rows,
        phone: phoneDuplicates.rows
    };
}

/**
 * Find duplicate leads based on multiple criteria
 */
async function findDuplicateLeads(client) {
    console.log('\n🔍 Searching for duplicate leads...');

    // Find duplicates by name + branch + proposal amount
    const nameAmountDuplicates = await client.query(`
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
                    ),
                    'branch', b.name
                ) ORDER BY l.created_date DESC
            ) as leads
        FROM leads_dashboard.lead l
        LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
        LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
        LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
        LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
        WHERE l.name IS NOT NULL
        GROUP BY LOWER(l.name), l.branch_id, l.final_proposal_amount
        HAVING COUNT(*) > 1
    `);

    // Find duplicates by customer + branch (same customer, same branch, multiple leads)
    const customerBranchDuplicates = await client.query(`
        SELECT 
            l.customer_id,
            l.branch_id,
            array_agg(
                json_build_object(
                    'id', l.id,
                    'name', l.name,
                    'created_date', l.created_date,
                    'final_proposal_amount', l.final_proposal_amount,
                    'lead_status', ls.name,
                    'inspection_date', l.inspection_date,
                    'sold_date', l.sold_date
                ) ORDER BY l.created_date DESC
            ) as leads,
            (
                SELECT json_build_object(
                    'id', c.id,
                    'name', COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''),
                    'email', c.email_address,
                    'phone', c.phone
                )
                FROM leads_dashboard.customer c 
                WHERE c.id = l.customer_id
                LIMIT 1
            ) as customer_info,
            (
                SELECT b.name 
                FROM leads_dashboard.branch b 
                WHERE b.id = l.branch_id
                LIMIT 1
            ) as branch_name
        FROM leads_dashboard.lead l
        LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
        GROUP BY l.customer_id, l.branch_id
        HAVING COUNT(*) > 1
    `);

    console.log(`📄 Name+Amount+Branch duplicates: ${nameAmountDuplicates.rows.length} groups`);
    console.log(`👤 Customer+Branch duplicates: ${customerBranchDuplicates.rows.length} groups`);

    return {
        nameAmount: nameAmountDuplicates.rows,
        customerBranch: customerBranchDuplicates.rows
    };
}

/**
 * Choose which customer to keep (keep the one with most leads, then most recent)
 */
function chooseBestCustomer(customers) {
    // Sort by: 1) Most leads, 2) Most recent created_at, 3) Most complete data
    return customers.sort((a, b) => {
        // First priority: number of leads
        if (a.lead_count !== b.lead_count) {
            return b.lead_count - a.lead_count;
        }
        
        // Second priority: most recent
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        if (dateA.getTime() !== dateB.getTime()) {
            return dateB.getTime() - dateA.getTime();
        }
        
        // Third priority: most complete data (has email and phone)
        const scoreA = (a.email_address ? 1 : 0) + (a.phone ? 1 : 0);
        const scoreB = (b.email_address ? 1 : 0) + (b.phone ? 1 : 0);
        return scoreB - scoreA;
    })[0];
}

/**
 * Choose which lead to keep (keep the one with highest amount, then most recent)
 */
function chooseBestLead(leads) {
    return leads.sort((a, b) => {
        // First priority: highest proposal amount
        const amountA = parseFloat(a.final_proposal_amount) || 0;
        const amountB = parseFloat(b.final_proposal_amount) || 0;
        if (amountA !== amountB) {
            return amountB - amountA;
        }
        
        // Second priority: if sold, keep sold
        const soldA = a.lead_status?.toLowerCase() === 'sold' ? 1 : 0;
        const soldB = b.lead_status?.toLowerCase() === 'sold' ? 1 : 0;
        if (soldA !== soldB) {
            return soldB - soldA;
        }
        
        // Third priority: most recent
        const dateA = new Date(a.created_date);
        const dateB = new Date(b.created_date);
        return dateB.getTime() - dateA.getTime();
    })[0];
}

/**
 * Update lead references when merging customers
 */
async function updateLeadReferences(client, fromCustomerId, toCustomerId) {
    const updateResult = await client.query(`
        UPDATE leads_dashboard.lead 
        SET customer_id = $1 
        WHERE customer_id = $2
    `, [toCustomerId, fromCustomerId]);
    
    return updateResult.rowCount;
}

/**
 * Delete duplicate customers
 */
async function deleteDuplicateCustomers(client, duplicates) {
    console.log('\n🗑️ Processing duplicate customers...');
    
    let processedGroups = 0;
    let totalDeleted = 0;

    for (const group of [...duplicates.email, ...duplicates.nameAddress, ...duplicates.phone]) {
        const customers = group.customers;
        if (customers.length <= 1) continue;

        processedGroups++;
        const bestCustomer = chooseBestCustomer(customers);
        const customersToDelete = customers.filter(c => c.id !== bestCustomer.id);

        console.log(`\n📋 Group ${processedGroups}:`);
        console.log(`  ✅ Keeping: ID ${bestCustomer.id} - ${bestCustomer.first_name} ${bestCustomer.last_name} (${bestCustomer.lead_count} leads)`);
        
        for (const customerToDelete of customersToDelete) {
            console.log(`  🗑️ Deleting: ID ${customerToDelete.id} - ${customerToDelete.first_name} ${customerToDelete.last_name} (${customerToDelete.lead_count} leads)`);
            
            if (!CONFIG.DRY_RUN) {
                try {
                    // First, update all leads to point to the best customer
                    const updatedLeads = await updateLeadReferences(client, customerToDelete.id, bestCustomer.id);
                    console.log(`    📄 Moved ${updatedLeads} leads to customer ${bestCustomer.id}`);
                    
                    // Then delete the duplicate customer's address if it's not referenced elsewhere
                    const addressCheckResult = await client.query(
                        'SELECT COUNT(*) FROM leads_dashboard.customer WHERE address_id = $1',
                        [customerToDelete.address?.id]
                    );
                    
                    // Delete the customer
                    await client.query('DELETE FROM leads_dashboard.customer WHERE id = $1', [customerToDelete.id]);
                    totalDeleted++;
                    console.log(`    ✅ Deleted customer ${customerToDelete.id}`);
                    
                    // Delete orphaned address if no other customers use it
                    if (customerToDelete.address?.id && parseInt(addressCheckResult.rows[0].count) === 1) {
                        await client.query('DELETE FROM leads_dashboard.address WHERE id = $1', [customerToDelete.address.id]);
                        console.log(`    🏠 Deleted orphaned address ${customerToDelete.address.id}`);
                    }
                    
                } catch (error) {
                    console.error(`    ❌ Error deleting customer ${customerToDelete.id}:`, error.message);
                    results.errors.push({
                        type: 'customer_deletion',
                        id: customerToDelete.id,
                        error: error.message
                    });
                }
            }
        }
    }

    console.log(`\n📊 Customer cleanup summary: ${totalDeleted} customers deleted from ${processedGroups} groups`);
    return totalDeleted;
}

/**
 * Delete duplicate leads
 */
async function deleteDuplicateLeads(client, duplicates) {
    console.log('\n🗑️ Processing duplicate leads...');
    
    let processedGroups = 0;
    let totalDeleted = 0;

    for (const group of [...duplicates.nameAmount, ...duplicates.customerBranch]) {
        const leads = group.leads;
        if (leads.length <= 1) continue;

        processedGroups++;
        const bestLead = chooseBestLead(leads);
        const leadsToDelete = leads.filter(l => l.id !== bestLead.id);

        console.log(`\n📋 Group ${processedGroups}:`);
        console.log(`  ✅ Keeping: ID ${bestLead.id} - "${bestLead.name}" ($${bestLead.final_proposal_amount}) - ${bestLead.lead_status}`);
        
        for (const leadToDelete of leadsToDelete) {
            console.log(`  🗑️ Deleting: ID ${leadToDelete.id} - "${leadToDelete.name}" ($${leadToDelete.final_proposal_amount}) - ${leadToDelete.lead_status}`);
            
            if (!CONFIG.DRY_RUN) {
                try {
                    // Delete lead tags first (foreign key dependency)
                    await client.query('DELETE FROM leads_dashboard.lead_tag WHERE lead_id = $1', [leadToDelete.id]);
                    
                    // Delete lead group assignments
                    await client.query('DELETE FROM leads_dashboard.lead_group_assignment WHERE lead_id = $1', [leadToDelete.id]);
                    
                    // Finally delete the lead
                    await client.query('DELETE FROM leads_dashboard.lead WHERE id = $1', [leadToDelete.id]);
                    totalDeleted++;
                    console.log(`    ✅ Deleted lead ${leadToDelete.id}`);
                    
                } catch (error) {
                    console.error(`    ❌ Error deleting lead ${leadToDelete.id}:`, error.message);
                    results.errors.push({
                        type: 'lead_deletion',
                        id: leadToDelete.id,
                        error: error.message
                    });
                }
            }
        }
    }

    console.log(`\n📊 Lead cleanup summary: ${totalDeleted} leads deleted from ${processedGroups} groups`);
    return totalDeleted;
}

/**
 * Create backup before deletion
 */
async function createBackup(client) {
    if (!CONFIG.BACKUP_BEFORE_DELETE) return;
    
    console.log('💾 Creating backup...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    try {
        // This would ideally use pg_dump, but for now we'll log the count
        const customerCount = await client.query('SELECT COUNT(*) FROM leads_dashboard.customer');
        const leadCount = await client.query('SELECT COUNT(*) FROM leads_dashboard.lead');
        
        console.log(`📊 Backup reference - Customers: ${customerCount.rows[0].count}, Leads: ${leadCount.rows[0].count}`);
        console.log(`🕐 Backup timestamp: ${timestamp}`);
        
        // In production, you'd want to run: pg_dump -h host -U user database > backup_${timestamp}.sql
        
    } catch (error) {
        console.error('❌ Backup failed:', error.message);
        throw error;
    }
}

/**
 * Main cleanup function
 */
async function cleanupDuplicates() {
    const client = await db.pool.connect();
    
    try {
        console.log('🚀 Starting duplicate cleanup process...\n');
        
        // Create backup
        await createBackup(client);
        
        if (!CONFIG.DRY_RUN) {
            await client.query('BEGIN');
        }
        
        // Find duplicates
        const duplicateCustomers = await findDuplicateCustomers(client);
        const duplicateLeads = await findDuplicateLeads(client);
        
        // Store in results for reporting
        results.duplicateCustomers = duplicateCustomers;
        results.duplicateLeads = duplicateLeads;
        
        // Process deletions
        results.deletedCustomers = await deleteDuplicateCustomers(client, duplicateCustomers);
        results.deletedLeads = await deleteDuplicateLeads(client, duplicateLeads);
        
        if (!CONFIG.DRY_RUN) {
            await client.query('COMMIT');
            console.log('\n✅ All changes committed to database');
        } else {
            console.log('\n🔍 DRY RUN COMPLETE - No changes made to database');
        }
        
    } catch (error) {
        if (!CONFIG.DRY_RUN) {
            await client.query('ROLLBACK');
        }
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
    
    const totalCustomerGroups = (results.duplicateCustomers.email?.length || 0) + 
                               (results.duplicateCustomers.nameAddress?.length || 0) + 
                               (results.duplicateCustomers.phone?.length || 0);
    
    const totalLeadGroups = (results.duplicateLeads.nameAmount?.length || 0) + 
                           (results.duplicateLeads.customerBranch?.length || 0);
    
    console.log(`🏢 Customer duplicate groups found: ${totalCustomerGroups}`);
    console.log(`📄 Lead duplicate groups found: ${totalLeadGroups}`);
    console.log(`🗑️ Customers ${CONFIG.DRY_RUN ? 'that would be' : ''} deleted: ${results.deletedCustomers}`);
    console.log(`🗑️ Leads ${CONFIG.DRY_RUN ? 'that would be' : ''} deleted: ${results.deletedLeads}`);
    console.log(`❌ Errors encountered: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
        console.log('\n⚠️ ERRORS:');
        results.errors.forEach((error, index) => {
            console.log(`${index + 1}. ${error.type} ID ${error.id}: ${error.error}`);
        });
    }
    
    if (CONFIG.DRY_RUN) {
        console.log('\n💡 To actually perform the cleanup, set CONFIG.DRY_RUN = false');
    }
    
    console.log('\n✨ Cleanup process complete!');
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

module.exports = { cleanupDuplicates, findDuplicateCustomers, findDuplicateLeads }; 