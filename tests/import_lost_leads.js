const fetch = require('node-fetch');
const db = require('../config/database');

// Branch mapping from API to your database
const BRANCH_MAPPING = {
    1: 'Orange County',    // Orange -> Orange County
    3: 'San Diego',        // San Diego -> San Diego  
    4: 'Everett',          // Everett -> Everett
    5: 'Seattle/Kent',     // Seattle/Kent -> Seattle/Kent
    7: 'San Bernandino'    // San Bernardino -> San Bernandino (note spelling difference)
};

const API_BRANCH_IDS = [1, 3, 4, 5, 7];

async function fetchLostLeadsFromAPI(branchId) {
    const url = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[status][$eq]=Lost&filters[branch][id][$eq]=${branchId}&pagination[start]=0&pagination[limit]=1000&sort=updatedAt:desc&populate[0]=customer_info&populate[1]=branch_configuration&fields[0]=name&fields[1]=status&fields[2]=true_cost&fields[3]=labor_hours&fields[4]=address&fields[5]=retail_cost&fields[6]=final_price&fields[7]=discount_provided`;

    try {
        console.log(`📡 Fetching lost leads from ${BRANCH_MAPPING[branchId]} (API Branch ${branchId})...`);
        
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                "accept": "application/json, text/plain, */*",
                "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
                "Referer": "https://www.attic-tech.com/"
            }
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        console.log(`   ✅ Found ${data.data.length} lost leads`);
        
        return data.data.map(lead => {
            const a = lead.attributes;
            const multiplier = a.true_cost > 0 ? a.final_price / a.true_cost : null;

            return {
                api_id: lead.id,
                api_branch_id: branchId,
                branch_name: BRANCH_MAPPING[branchId],
                name: a.name || '',
                status: a.status,
                true_cost: a.true_cost || 0,
                labor_hours: a.labor_hours || 0,
                address: a.address || '',
                retail_cost: a.retail_cost || 0,
                final_price: a.final_price || 0,
                discount_provided: a.discount_provided || 0,
                multiplier: multiplier,
                customer_info: a.customer_info?.data?.attributes || null,
                branch_configuration: a.branch_configuration?.data?.attributes || null
            };
        });

    } catch (error) {
        console.error(`❌ Error fetching ${BRANCH_MAPPING[branchId]}:`, error.message);
        return [];
    }
}

async function importLostLeadsToDatabase() {
    const client = await db.pool.connect();
    
    try {
        await client.query('BEGIN');
        console.log('🚀 Starting lost leads import...\n');

        // Get branch IDs from database
        const branchQuery = await client.query('SELECT id, name FROM leads_dashboard.branch');
        const dbBranches = {};
        branchQuery.rows.forEach(branch => {
            dbBranches[branch.name] = branch.id;
        });

        console.log('🏢 Available database branches:');
        Object.keys(dbBranches).forEach(name => {
            console.log(`   - ${name} (ID: ${dbBranches[name]})`);
        });
        console.log('');

        // Get "Lost" lead status ID
        const lostStatusQuery = await client.query(
            'SELECT id FROM leads_dashboard.lead_status WHERE name = $1',
            ['Lost']
        );
        
        let lostStatusId;
        if (lostStatusQuery.rows.length === 0) {
            // Create "Lost" status if it doesn't exist
            const newStatus = await client.query(
                'INSERT INTO leads_dashboard.lead_status (name) VALUES ($1) RETURNING id',
                ['Lost']
            );
            lostStatusId = newStatus.rows[0].id;
            console.log('✅ Created "Lost" lead status');
        } else {
            lostStatusId = lostStatusQuery.rows[0].id;
            console.log('✅ Found existing "Lost" lead status');
        }

        let totalImported = 0;
        let totalErrors = 0;

        // Fetch and import leads from each branch
        for (const apiBranchId of API_BRANCH_IDS) {
            const branchName = BRANCH_MAPPING[apiBranchId];
            const dbBranchId = dbBranches[branchName];

            if (!dbBranchId) {
                console.log(`⚠️  Branch "${branchName}" not found in database, skipping...`);
                continue;
            }

            console.log(`\n🔄 Processing ${branchName}...`);
            
            const lostLeads = await fetchLostLeadsFromAPI(apiBranchId);
            
            if (lostLeads.length === 0) {
                console.log(`   ℹ️  No lost leads found for ${branchName}`);
                continue;
            }

            // Check for existing leads to avoid duplicates
            const existingLeads = await client.query(
                'SELECT name, final_proposal_amount FROM leads_dashboard.lead WHERE branch_id = $1 AND lead_status_id = $2',
                [dbBranchId, lostStatusId]
            );

            const existingLeadKeys = new Set(
                existingLeads.rows.map(lead => `${lead.name}-${lead.final_proposal_amount}`)
            );

            let branchImported = 0;
            let branchSkipped = 0;

            for (const lead of lostLeads) {
                try {
                    // Create a unique key to check for duplicates
                    const leadKey = `${lead.name}-${lead.final_price}`;
                    
                    if (existingLeadKeys.has(leadKey)) {
                        branchSkipped++;
                        continue;
                    }

                    // Parse customer name from the lead name (format: "FirstName LastName - CODE")
                    const nameParts = lead.name.split(' - ')[0].split(' ');
                    const firstName = nameParts[0] || '';
                    const lastName = nameParts.slice(1).join(' ') || '';

                    // Parse address
                    const addressParts = lead.address.split(', ');
                    const street = addressParts[0] || '';
                    const cityState = addressParts[1] || '';
                    const zipCode = addressParts[2] || '';
                    
                    const cityStateParts = cityState.split(' ');
                    const state = cityStateParts.pop() || '';
                    const city = cityStateParts.join(' ') || '';

                    // Create address
                    const addressResult = await client.query(
                        'INSERT INTO leads_dashboard.address (street, city, state, zip_code) VALUES ($1, $2, $3, $4) RETURNING id',
                        [street, city, state, zipCode]
                    );
                    const addressId = addressResult.rows[0].id;

                    // Create customer
                    const customerResult = await client.query(
                        'INSERT INTO leads_dashboard.customer (address_id, first_name, last_name, email_address, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                        [addressId, firstName, lastName, '', '']
                    );
                    const customerId = customerResult.rows[0].id;

                    // Get or create "Unknown" salesperson for this branch
                    let salespersonResult = await client.query(
                        'SELECT id FROM leads_dashboard.sales_person WHERE name = $1 AND branch_id = $2',
                        ['Unknown', dbBranchId]
                    );

                    if (salespersonResult.rows.length === 0) {
                        salespersonResult = await client.query(
                            'INSERT INTO leads_dashboard.sales_person (name, branch_id) VALUES ($1, $2) RETURNING id',
                            ['Unknown', dbBranchId]
                        );
                    }
                    const salespersonId = salespersonResult.rows[0].id;

                    // Get or create "API Import" source
                    let sourceResult = await client.query(
                        'SELECT id FROM leads_dashboard.source WHERE name = $1',
                        ['API Import']
                    );

                    if (sourceResult.rows.length === 0) {
                        sourceResult = await client.query(
                            'INSERT INTO leads_dashboard.source (name) VALUES ($1) RETURNING id',
                            ['API Import']
                        );
                    }
                    const sourceId = sourceResult.rows[0].id;

                    // Get or create default proposal status
                    let proposalStatusResult = await client.query(
                        'SELECT id FROM leads_dashboard.proposal_status WHERE name = $1',
                        ['Lost']
                    );

                    if (proposalStatusResult.rows.length === 0) {
                        proposalStatusResult = await client.query(
                            'INSERT INTO leads_dashboard.proposal_status (name) VALUES ($1) RETURNING id',
                            ['Lost']
                        );
                    }
                    const proposalStatusId = proposalStatusResult.rows[0].id;

                    // Get or create default condition
                    let conditionResult = await client.query(
                        'SELECT id FROM leads_dashboard.condition WHERE name = $1',
                        ['Normal']
                    );

                    if (conditionResult.rows.length === 0) {
                        conditionResult = await client.query(
                            'INSERT INTO leads_dashboard.condition (name) VALUES ($1) RETURNING id',
                            ['Normal']
                        );
                    }
                    const conditionId = conditionResult.rows[0].id;

                    // Get or create property type
                    let propertyTypeResult = await client.query(
                        'SELECT id FROM leads_dashboard.property_type WHERE name = $1',
                        ['Residential']
                    );

                    if (propertyTypeResult.rows.length === 0) {
                        propertyTypeResult = await client.query(
                            'INSERT INTO leads_dashboard.property_type (name) VALUES ($1) RETURNING id',
                            ['Residential']
                        );
                    }
                    const propertyTypeId = propertyTypeResult.rows[0].id;

                    // Create the lead
                    await client.query(
                        `INSERT INTO leads_dashboard.lead 
                        (name, created_date, lead_status_id, sales_person_id, source_id, 
                        proposal_status_id, customer_id, note, condition_id, property_type_id, 
                        final_proposal_amount, proposal_tm, branch_id) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                        [
                            lead.name,
                            new Date().toISOString().split('T')[0], // Use today as created date
                            lostStatusId,
                            salespersonId,
                            sourceId,
                            proposalStatusId,
                            customerId,
                            `API Import - True Cost: $${lead.true_cost}, Labor Hours: ${lead.labor_hours}, Multiplier: ${lead.multiplier?.toFixed(2) || 'N/A'}`,
                            conditionId,
                            propertyTypeId,
                            lead.final_price,
                            0, // No T&M data available
                            dbBranchId
                        ]
                    );

                    branchImported++;
                    totalImported++;

                } catch (error) {
                    console.error(`   ❌ Error importing lead "${lead.name}":`, error.message);
                    totalErrors++;
                }
            }

            console.log(`   ✅ ${branchName}: Imported ${branchImported}, Skipped ${branchSkipped} duplicates`);
        }

        await client.query('COMMIT');
        
        console.log('\n🎉 Import completed successfully!');
        console.log(`📊 Summary:`);
        console.log(`   ✅ Total imported: ${totalImported}`);
        console.log(`   ❌ Total errors: ${totalErrors}`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('💥 Import failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run the import
if (require.main === module) {
    importLostLeadsToDatabase()
        .then(() => {
            console.log('\n✨ Lost leads import completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Import failed:', error);
            process.exit(1);
        });
}

module.exports = { importLostLeadsToDatabase }; 