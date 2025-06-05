const db = require('../config/database');

async function showDuplicateSummary() {
    const client = await db.pool.connect();
    
    try {
        console.log('🔍 DUPLICATE SUMMARY REPORT');
        console.log('============================\n');

        // Quick count of all duplicates
        const leadDuplicates = await client.query(`
            SELECT 
                LOWER(l.name) as lead_name,
                l.branch_id,
                l.final_proposal_amount,
                COUNT(*) as duplicate_count,
                array_agg(l.id ORDER BY l.created_date DESC) as lead_ids,
                array_agg(l.created_date ORDER BY l.created_date DESC) as created_dates
            FROM leads_dashboard.lead l
            WHERE l.name IS NOT NULL
            GROUP BY LOWER(l.name), l.branch_id, l.final_proposal_amount
            HAVING COUNT(*) > 1
            ORDER BY COUNT(*) DESC
            LIMIT 10
        `);

        console.log(`📄 Total duplicate lead groups: ${leadDuplicates.rows.length > 0 ? 'Many' : '0'}`);
        console.log('\n🔝 TOP 10 WORST DUPLICATE GROUPS:');
        console.log('================================');

        leadDuplicates.rows.forEach((group, index) => {
            console.log(`\n${index + 1}. "${group.lead_name}" - Branch ${group.branch_id} - $${group.final_proposal_amount}`);
            console.log(`   💥 ${group.duplicate_count} duplicates found`);
            console.log(`   🆔 Lead IDs: ${group.lead_ids.slice(0, 3).join(', ')}${group.lead_ids.length > 3 ? '...' : ''}`);
            console.log(`   📅 Dates: ${group.created_dates.slice(0, 2).join(', ')}${group.created_dates.length > 2 ? '...' : ''}`);
        });

        // Count total duplicates to delete
        const totalDuplicatesQuery = await client.query(`
            SELECT 
                SUM(duplicate_count - 1) as total_to_delete
            FROM (
                SELECT COUNT(*) as duplicate_count
                FROM leads_dashboard.lead l
                WHERE l.name IS NOT NULL
                GROUP BY LOWER(l.name), l.branch_id, l.final_proposal_amount
                HAVING COUNT(*) > 1
            ) counts
        `);

        const totalToDelete = totalDuplicatesQuery.rows[0]?.total_to_delete || 0;
        
        console.log(`\n📊 SUMMARY:`);
        console.log(`🗑️ Total duplicate leads that would be deleted: ${totalToDelete}`);
        console.log(`✅ Total unique leads that would be kept: Unknown (run full analysis)`);
        
        if (totalToDelete > 0) {
            console.log(`\n💡 To proceed with cleanup:`);
            console.log(`   node scripts/run-duplicate-cleanup.js --live`);
            console.log(`\n⚠️ RECOMMENDATION: Start with a small test!`);
            console.log(`   - Make a database backup first`);
            console.log(`   - Consider cleaning a few groups manually first`);
        }

    } catch (error) {
        console.error('❌ Error generating summary:', error);
    } finally {
        client.release();
    }
}

// Run the summary
if (require.main === module) {
    showDuplicateSummary()
        .then(() => {
            console.log('\n✨ Summary complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Summary failed:', error);
            process.exit(1);
        });
}

module.exports = { showDuplicateSummary }; 