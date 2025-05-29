const https = require('https');
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

function makeHttpsRequest(url, headers) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { headers }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve(jsonData);
                } catch (error) {
                    reject(new Error(`Failed to parse JSON: ${error.message}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.end();
    });
}

async function fetchLostLeadsFromAPI(branchId) {
    const allLeads = [];
    let start = 0;
    const limit = 100; // Keep the limit at 100 per request
    let hasMoreData = true;

    try {
        console.log(`📡 Fetching lost leads from ${BRANCH_MAPPING[branchId]} (API Branch ${branchId})...`);
        
        while (hasMoreData) {
            const url = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[status][$eq]=Lost&filters[branch][id][$eq]=${branchId}&pagination[start]=${start}&pagination[limit]=${limit}&sort=updatedAt:desc&populate[0]=customer_info&populate[1]=branch_configuration&fields[0]=name&fields[1]=status&fields[2]=true_cost&fields[3]=labor_hours&fields[4]=address&fields[5]=retail_cost&fields[6]=final_price&fields[7]=discount_provided`;

            console.log(`   📄 Fetching page ${Math.floor(start/limit) + 1} (records ${start + 1}-${start + limit})...`);
            
            const data = await makeHttpsRequest(url, {
                "accept": "application/json, text/plain, */*",
                "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
                "Referer": "https://www.attic-tech.com/"
            });

            const pageLeads = data.data || [];
            console.log(`      ✅ Retrieved ${pageLeads.length} leads from this page`);
            
            if (pageLeads.length === 0) {
                hasMoreData = false;
                break;
            }
            
            // Add leads from this page to our collection
            const processedLeads = pageLeads.map(lead => {
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
            
            allLeads.push(...processedLeads);
            
            // Check if we got fewer results than the limit (indicates last page)
            if (pageLeads.length < limit) {
                hasMoreData = false;
            } else {
                start += limit;
                // Add a small delay to be respectful to the API
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        console.log(`   🎉 Total found: ${allLeads.length} lost leads for ${BRANCH_MAPPING[branchId]}`);
        return allLeads;

    } catch (error) {
        console.error(`❌ Error fetching ${BRANCH_MAPPING[branchId]}:`, error.message);
        return allLeads; // Return what we have so far
    }
}

async function getExistingLostLeads() {
    const client = await db.pool.connect();
    
    try {
        console.log('🔍 Fetching existing "Lost" leads from database...');
        
        const query = `
            SELECT 
                l.id,
                l.name,
                l.final_proposal_amount,
                l.created_date,
                b.name as branch_name,
                sp.name as salesperson_name,
                c.first_name,
                c.last_name,
                a.street,
                a.city,
                a.state,
                a.zip_code
            FROM leads_dashboard.lead l
            JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
            JOIN leads_dashboard.branch b ON l.branch_id = b.id
            LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
            LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
            LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
            WHERE ls.name = 'Lost'
            ORDER BY b.name, l.name
        `;
        
        const result = await client.query(query);
        console.log(`   ✅ Found ${result.rows.length} existing lost leads in database`);
        
        return result.rows.map(row => ({
            db_id: row.id,
            name: row.name,
            final_proposal_amount: parseFloat(row.final_proposal_amount) || 0,
            created_date: row.created_date,
            branch_name: row.branch_name,
            salesperson_name: row.salesperson_name,
            customer_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
            address: `${row.street || ''}, ${row.city || ''} ${row.state || ''} ${row.zip_code || ''}`.replace(/,\s*,/g, ',').trim(),
            raw_address: {
                street: row.street || '',
                city: row.city || '',
                state: row.state || '',
                zip_code: row.zip_code || ''
            }
        }));
        
    } finally {
        client.release();
    }
}

function normalizeLeadName(name) {
    // Remove common suffixes and normalize
    return name
        .toLowerCase()
        .replace(/\s*-\s*[a-z0-9]+$/i, '') // Remove " - CODE" suffix
        .replace(/[^\w\s]/g, '') // Remove special characters
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();
}

function normalizeAddress(address) {
    return address
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove special characters
        .replace(/\s+/g, ' ') // Normalize spaces
        .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl)\b/g, '') // Remove street types
        .replace(/\b(apt|apartment|unit|ste|suite|#)\s*\w*\b/g, '') // Remove apartment/unit numbers
        .trim();
}

function parseApiAddress(address) {
    // Parse API address format: "Street, City State ZipCode"
    const parts = address.split(', ');
    if (parts.length < 2) return { street: '', city: '', state: '', zip_code: '' };
    
    const street = parts[0] || '';
    const cityStateZip = parts[1] || '';
    
    // Extract zip code (last 5 digits)
    const zipMatch = cityStateZip.match(/\b\d{5}(-\d{4})?\b$/);
    const zip_code = zipMatch ? zipMatch[0] : '';
    
    // Remove zip code to get city and state
    const cityState = cityStateZip.replace(/\b\d{5}(-\d{4})?\b$/, '').trim();
    const cityStateParts = cityState.split(' ');
    
    // Last part is usually state
    const state = cityStateParts.pop() || '';
    const city = cityStateParts.join(' ') || '';
    
    return { street, city, state, zip_code };
}

function addressesMatch(dbAddress, apiAddress) {
    const dbNormalized = normalizeAddress(dbAddress.street + ' ' + dbAddress.city);
    const apiParsed = parseApiAddress(apiAddress);
    const apiNormalized = normalizeAddress(apiParsed.street + ' ' + apiParsed.city);
    
    // Check if normalized addresses are similar
    if (dbNormalized && apiNormalized && dbNormalized.length > 5 && apiNormalized.length > 5) {
        // Check for exact match
        if (dbNormalized === apiNormalized) return true;
        
        // Check for partial match (one contains the other)
        if (dbNormalized.includes(apiNormalized) || apiNormalized.includes(dbNormalized)) return true;
        
        // Check if street numbers and street names match
        const dbStreetNum = dbAddress.street.match(/^\d+/);
        const apiStreetNum = apiParsed.street.match(/^\d+/);
        
        if (dbStreetNum && apiStreetNum && dbStreetNum[0] === apiStreetNum[0]) {
            // Same street number, check if street names are similar
            const dbStreetName = normalizeAddress(dbAddress.street.replace(/^\d+\s*/, ''));
            const apiStreetName = normalizeAddress(apiParsed.street.replace(/^\d+\s*/, ''));
            
            if (dbStreetName && apiStreetName && 
                (dbStreetName.includes(apiStreetName) || apiStreetName.includes(dbStreetName))) {
                return true;
            }
        }
    }
    
    return false;
}

function findMatches(dbLeads, apiLeads) {
    const matches = [];
    const dbOnlyLeads = [];
    const apiOnlyLeads = [];
    
    // Track which leads have been matched
    const matchedDbIds = new Set();
    const matchedApiIds = new Set();
    
    console.log('   🔍 Phase 1: Exact name + amount matching...');
    
    // Phase 1: Exact name and amount matches
    for (const dbLead of dbLeads) {
        if (matchedDbIds.has(dbLead.db_id)) continue;
        
        const dbNameNormalized = normalizeLeadName(dbLead.name);
        
        for (const apiLead of apiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            const apiNameNormalized = normalizeLeadName(apiLead.name);
            
            if (dbNameNormalized === apiNameNormalized && 
                Math.abs(dbLead.final_proposal_amount - apiLead.final_price) < 0.01) {
                
                matches.push({
                    db_lead: dbLead,
                    api_lead: apiLead,
                    match_type: 'name_and_amount',
                    confidence: 'high'
                });
                
                matchedDbIds.add(dbLead.db_id);
                matchedApiIds.add(apiLead.api_id);
                break;
            }
        }
    }
    
    console.log(`      ✅ Found ${matches.length} exact name + amount matches`);
    console.log('   🔍 Phase 2: Name-only matching...');
    
    // Phase 2: Name-only matches (different amounts)
    let nameOnlyMatches = 0;
    for (const dbLead of dbLeads) {
        if (matchedDbIds.has(dbLead.db_id)) continue;
        
        const dbNameNormalized = normalizeLeadName(dbLead.name);
        
        for (const apiLead of apiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            const apiNameNormalized = normalizeLeadName(apiLead.name);
            
            if (dbNameNormalized === apiNameNormalized) {
                matches.push({
                    db_lead: dbLead,
                    api_lead: apiLead,
                    match_type: 'name_only',
                    confidence: 'medium',
                    amount_diff: Math.abs(dbLead.final_proposal_amount - apiLead.final_price)
                });
                
                matchedDbIds.add(dbLead.db_id);
                matchedApiIds.add(apiLead.api_id);
                nameOnlyMatches++;
                break;
            }
        }
    }
    
    console.log(`      ✅ Found ${nameOnlyMatches} name-only matches`);
    console.log('   🔍 Phase 3: Address-based matching...');
    
    // Phase 3: Address-based matching for remaining leads
    let addressMatches = 0;
    for (const dbLead of dbLeads) {
        if (matchedDbIds.has(dbLead.db_id)) continue;
        
        for (const apiLead of apiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            // Only check address if both leads are from the same branch
            if (dbLead.branch_name === apiLead.branch_name && 
                addressesMatch(dbLead.raw_address, apiLead.address)) {
                
                matches.push({
                    db_lead: dbLead,
                    api_lead: apiLead,
                    match_type: 'address_only',
                    confidence: 'low',
                    name_diff: `"${dbLead.name}" vs "${apiLead.name}"`,
                    amount_diff: Math.abs(dbLead.final_proposal_amount - apiLead.final_price)
                });
                
                matchedDbIds.add(dbLead.db_id);
                matchedApiIds.add(apiLead.api_id);
                addressMatches++;
                break;
            }
        }
    }
    
    console.log(`      ✅ Found ${addressMatches} address-only matches`);
    
    // Collect unmatched leads
    for (const dbLead of dbLeads) {
        if (!matchedDbIds.has(dbLead.db_id)) {
            dbOnlyLeads.push(dbLead);
        }
    }
    
    for (const apiLead of apiLeads) {
        if (!matchedApiIds.has(apiLead.api_id)) {
            apiOnlyLeads.push(apiLead);
        }
    }
    
    return { matches, dbOnlyLeads, apiOnlyLeads };
}

async function compareLostLeads() {
    try {
        console.log('🔄 Starting enhanced lost leads comparison...\n');
        
        // Fetch existing lost leads from database
        const dbLeads = await getExistingLostLeads();
        
        // Fetch lost leads from API for all branches
        const allApiLeads = [];
        for (const branchId of API_BRANCH_IDS) {
            const branchLeads = await fetchLostLeadsFromAPI(branchId);
            allApiLeads.push(...branchLeads);
        }
        
        console.log(`\n📊 Data Summary:`);
        console.log(`   🗄️  Database lost leads: ${dbLeads.length}`);
        console.log(`   🌐 API lost leads: ${allApiLeads.length}`);
        
        // Group by branch for detailed analysis
        const dbByBranch = {};
        const apiByBranch = {};
        
        dbLeads.forEach(lead => {
            if (!dbByBranch[lead.branch_name]) {
                dbByBranch[lead.branch_name] = [];
            }
            dbByBranch[lead.branch_name].push(lead);
        });
        
        allApiLeads.forEach(lead => {
            if (!apiByBranch[lead.branch_name]) {
                apiByBranch[lead.branch_name] = [];
            }
            apiByBranch[lead.branch_name].push(lead);
        });
        
        console.log(`\n🏢 Branch Breakdown:`);
        const allBranches = new Set([...Object.keys(dbByBranch), ...Object.keys(apiByBranch)]);
        
        for (const branch of allBranches) {
            const dbCount = dbByBranch[branch]?.length || 0;
            const apiCount = apiByBranch[branch]?.length || 0;
            console.log(`   ${branch}: DB=${dbCount}, API=${apiCount}`);
        }
        
        // Find matches using enhanced algorithm
        console.log(`\n🔍 Finding matches with enhanced algorithm...`);
        const { matches, dbOnlyLeads, apiOnlyLeads } = findMatches(dbLeads, allApiLeads);
        
        // Categorize matches by type
        const exactMatches = matches.filter(m => m.match_type === 'name_and_amount');
        const nameMatches = matches.filter(m => m.match_type === 'name_only');
        const addressMatches = matches.filter(m => m.match_type === 'address_only');
        
        console.log(`\n📈 Enhanced Comparison Results:`);
        console.log(`   🎯 Exact matches (name + amount): ${exactMatches.length}`);
        console.log(`   📝 Name-only matches (diff amounts): ${nameMatches.length}`);
        console.log(`   🏠 Address-only matches (diff names): ${addressMatches.length}`);
        console.log(`   📊 Total matches: ${matches.length}`);
        console.log(`   🗄️  Database-only leads: ${dbOnlyLeads.length}`);
        console.log(`   🌐 API-only leads: ${apiOnlyLeads.length}`);
        
        // Show examples of each match type
        if (exactMatches.length > 0) {
            console.log(`\n🎯 Sample Exact Matches:`);
            exactMatches.slice(0, 3).forEach((match, index) => {
                console.log(`   ${index + 1}. "${match.db_lead.name}" - $${match.db_lead.final_proposal_amount} (${match.db_lead.branch_name})`);
            });
        }
        
        if (nameMatches.length > 0) {
            console.log(`\n📝 Sample Name-Only Matches:`);
            nameMatches.slice(0, 3).forEach((match, index) => {
                console.log(`   ${index + 1}. "${match.db_lead.name}"`);
                console.log(`      DB: $${match.db_lead.final_proposal_amount} | API: $${match.api_lead.final_price} | Diff: $${match.amount_diff.toFixed(2)}`);
            });
        }
        
        if (addressMatches.length > 0) {
            console.log(`\n🏠 Sample Address-Only Matches:`);
            addressMatches.slice(0, 3).forEach((match, index) => {
                console.log(`   ${index + 1}. ${match.name_diff}`);
                console.log(`      DB Address: ${match.db_lead.address}`);
                console.log(`      API Address: ${match.api_lead.address}`);
                console.log(`      Amount Diff: $${match.amount_diff.toFixed(2)}`);
            });
        }
        
        // Show some examples of API-only leads
        if (apiOnlyLeads.length > 0) {
            console.log(`\n🌐 Sample API-Only Leads (would be imported):`);
            apiOnlyLeads.slice(0, 5).forEach((lead, index) => {
                console.log(`   ${index + 1}. "${lead.name}" - $${lead.final_price} (${lead.branch_name})`);
                console.log(`      Address: ${lead.address}`);
            });
            
            if (apiOnlyLeads.length > 5) {
                console.log(`      ... and ${apiOnlyLeads.length - 5} more API-only leads`);
            }
        }
        
        // Calculate potential import count
        const potentialImports = apiOnlyLeads.length;
        console.log(`\n💡 Enhanced Import Recommendation:`);
        console.log(`   📥 Leads that would be imported: ${potentialImports}`);
        console.log(`   🔄 Leads that would be skipped (all matches): ${matches.length}`);
        console.log(`   🎯 High confidence matches: ${exactMatches.length}`);
        console.log(`   📝 Medium confidence matches: ${nameMatches.length}`);
        console.log(`   🏠 Low confidence matches (review recommended): ${addressMatches.length}`);
        
        return {
            summary: {
                database_leads: dbLeads.length,
                api_leads: allApiLeads.length,
                exact_matches: exactMatches.length,
                name_matches: nameMatches.length,
                address_matches: addressMatches.length,
                total_matches: matches.length,
                database_only: dbOnlyLeads.length,
                api_only: apiOnlyLeads.length,
                potential_imports: potentialImports
            },
            matches,
            dbOnlyLeads,
            apiOnlyLeads
        };
        
    } catch (error) {
        console.error('💥 Comparison failed:', error);
        throw error;
    }
}

// Run the comparison
if (require.main === module) {
    compareLostLeads()
        .then((results) => {
            console.log('\n✨ Enhanced lost leads comparison completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Comparison failed:', error);
            process.exit(1);
        });
}

module.exports = { compareLostLeads }; 