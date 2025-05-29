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
    const limit = 100;
    let hasMoreData = true;

    try {
        console.log(`📡 Fetching lost leads from ${BRANCH_MAPPING[branchId]} (API Branch ${branchId})...`);
        
        while (hasMoreData) {
            const url = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[status][$eq]=Lost&filters[branch][id][$eq]=${branchId}&pagination[start]=${start}&pagination[limit]=${limit}&sort=updatedAt:desc&populate[0]=customer_info&populate[1]=branch_configuration&fields[0]=name&fields[1]=status&fields[2]=true_cost&fields[3]=labor_hours&fields[4]=address&fields[5]=retail_cost&fields[6]=final_price&fields[7]=discount_provided`;

            const data = await makeHttpsRequest(url, {
                "accept": "application/json, text/plain, */*",
                "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
                "Referer": "https://www.attic-tech.com/"
            });

            const pageLeads = data.data || [];
            
            if (pageLeads.length === 0) {
                hasMoreData = false;
                break;
            }
            
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
            
            if (pageLeads.length < limit) {
                hasMoreData = false;
            } else {
                start += limit;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        console.log(`   ✅ Found ${allLeads.length} lost leads`);
        return allLeads;

    } catch (error) {
        console.error(`❌ Error fetching ${BRANCH_MAPPING[branchId]}:`, error.message);
        return allLeads;
    }
}

async function getAllDatabaseLeads() {
    const client = await db.pool.connect();
    
    try {
        console.log('🔍 Fetching ALL leads from database (not just lost ones)...');
        
        const query = `
            SELECT 
                l.id,
                l.name,
                l.final_proposal_amount,
                l.retail_cost,
                l.discount_provided,
                l.proposal_tm,
                l.matched,
                l.created_date,
                b.name as branch_name,
                sp.name as salesperson_name,
                ls.name as lead_status,
                c.first_name,
                c.last_name,
                a.street,
                a.city,
                a.state,
                a.zip_code
            FROM leads_dashboard.lead l
            JOIN leads_dashboard.branch b ON l.branch_id = b.id
            LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
            LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
            LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
            LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
            ORDER BY b.name, l.name
        `;
        
        const result = await client.query(query);
        console.log(`   ✅ Found ${result.rows.length} total leads in database`);
        
        // Group by status for reporting
        const statusCounts = {};
        result.rows.forEach(row => {
            const status = row.lead_status || 'No Status';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        
        console.log('   📊 Lead status breakdown:');
        Object.entries(statusCounts).forEach(([status, count]) => {
            console.log(`      ${status}: ${count} leads`);
        });
        
        return result.rows.map(row => ({
            db_id: row.id,
            name: row.name,
            final_proposal_amount: parseFloat(row.final_proposal_amount) || 0,
            retail_cost: parseFloat(row.retail_cost) || 0,
            discount_provided: parseFloat(row.discount_provided) || 0,
            proposal_tm: parseFloat(row.proposal_tm) || 0,
            matched: row.matched || false,
            created_date: row.created_date,
            branch_name: row.branch_name,
            lead_status: row.lead_status,
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
    return name
        .toLowerCase()
        .replace(/\s*-\s*[a-z0-9]+$/i, '')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeAddress(address) {
    return address
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl)\b/g, '')
        .replace(/\b(apt|apartment|unit|ste|suite|#)\s*\w*\b/g, '')
        .trim();
}

function parseApiAddress(address) {
    const parts = address.split(', ');
    if (parts.length < 2) return { street: '', city: '', state: '', zip_code: '' };
    
    const street = parts[0] || '';
    const cityStateZip = parts[1] || '';
    
    const zipMatch = cityStateZip.match(/\b\d{5}(-\d{4})?\b$/);
    const zip_code = zipMatch ? zipMatch[0] : '';
    
    const cityState = cityStateZip.replace(/\b\d{5}(-\d{4})?\b$/, '').trim();
    const cityStateParts = cityState.split(' ');
    
    let state = '';
    let city = '';
    
    if (cityStateParts.length >= 2) {
        state = cityStateParts[cityStateParts.length - 1];
        city = cityStateParts.slice(0, -1).join(' ');
    } else {
        city = cityState;
    }
    
    return { street, city, state, zip_code };
}

function addressesMatch(dbAddress, apiAddress) {
    const dbNormalized = normalizeAddress(dbAddress.address || '');
    const apiParsed = parseApiAddress(apiAddress);
    const apiNormalized = normalizeAddress(`${apiParsed.street} ${apiParsed.city} ${apiParsed.state}`);
    
    if (dbNormalized.length < 5 || apiNormalized.length < 5) return false;
    
    const similarity = calculateStringSimilarity(dbNormalized, apiNormalized);
    return similarity > 0.7;
}

function calculateStringSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

function findMatches(dbLeads, apiLeads) {
    const matches = [];
    const unmatchedApiLeads = [];
    
    console.log('\n🔍 Starting enhanced matching process...');
    console.log(`   📊 Database leads: ${dbLeads.length}`);
    console.log(`   📊 API lost leads: ${apiLeads.length}`);
    
    // Group database leads by branch for more efficient matching
    const dbLeadsByBranch = {};
    dbLeads.forEach(lead => {
        if (!dbLeadsByBranch[lead.branch_name]) {
            dbLeadsByBranch[lead.branch_name] = [];
        }
        dbLeadsByBranch[lead.branch_name].push(lead);
    });
    
    console.log('\n   📊 Database leads by branch:');
    Object.entries(dbLeadsByBranch).forEach(([branch, leads]) => {
        console.log(`      ${branch}: ${leads.length} leads`);
    });
    
    for (const apiLead of apiLeads) {
        const branchLeads = dbLeadsByBranch[apiLead.branch_name] || [];
        let bestMatch = null;
        let bestScore = 0;
        let matchType = '';
        
        for (const dbLead of branchLeads) {
            // Skip if already matched (unless we want to re-evaluate)
            // if (dbLead.matched) continue;
            
            const apiNameNorm = normalizeLeadName(apiLead.name);
            const dbNameNorm = normalizeLeadName(dbLead.name);
            
            // Phase 1: Exact name + amount match (highest confidence)
            if (apiNameNorm === dbNameNorm) {
                const amountDiff = Math.abs(apiLead.final_price - dbLead.final_proposal_amount);
                const amountTolerance = Math.max(apiLead.final_price * 0.05, 100); // 5% or $100
                
                if (amountDiff <= amountTolerance) {
                    bestMatch = dbLead;
                    bestScore = 1.0;
                    matchType = 'exact_name_amount';
                    break;
                }
            }
            
            // Phase 2: Name similarity + amount match (high confidence)
            const nameSimilarity = calculateStringSimilarity(apiNameNorm, dbNameNorm);
            if (nameSimilarity > 0.8) {
                const amountDiff = Math.abs(apiLead.final_price - dbLead.final_proposal_amount);
                const amountTolerance = Math.max(apiLead.final_price * 0.1, 200); // 10% or $200
                
                if (amountDiff <= amountTolerance) {
                    const score = nameSimilarity * 0.9;
                    if (score > bestScore) {
                        bestMatch = dbLead;
                        bestScore = score;
                        matchType = 'name_amount_similarity';
                    }
                }
            }
            
            // Phase 3: Address-based matching (medium confidence)
            if (addressesMatch(dbLead, apiLead.address)) {
                const score = 0.7;
                if (score > bestScore) {
                    bestMatch = dbLead;
                    bestScore = score;
                    matchType = 'address_match';
                }
            }
            
            // Phase 4: Name-only match with different amounts (lower confidence)
            if (nameSimilarity > 0.85) {
                const score = nameSimilarity * 0.6;
                if (score > bestScore) {
                    bestMatch = dbLead;
                    bestScore = score;
                    matchType = 'name_only';
                }
            }
        }
        
        if (bestMatch && bestScore > 0.6) {
            matches.push({
                api_lead: apiLead,
                db_lead: bestMatch,
                match_score: bestScore,
                match_type: matchType,
                confidence: bestScore > 0.9 ? 'high' : bestScore > 0.75 ? 'medium' : 'low'
            });
        } else {
            unmatchedApiLeads.push(apiLead);
        }
    }
    
    console.log(`\n✅ Matching complete:`);
    console.log(`   🎯 Found ${matches.length} matches`);
    console.log(`   ❌ ${unmatchedApiLeads.length} API leads remain unmatched`);
    
    // Show match type breakdown
    const matchTypeBreakdown = {};
    matches.forEach(match => {
        matchTypeBreakdown[match.match_type] = (matchTypeBreakdown[match.match_type] || 0) + 1;
    });
    
    console.log('\n   📊 Match type breakdown:');
    Object.entries(matchTypeBreakdown).forEach(([type, count]) => {
        console.log(`      ${type}: ${count} matches`);
    });
    
    // Show confidence breakdown
    const confidenceBreakdown = {};
    matches.forEach(match => {
        confidenceBreakdown[match.confidence] = (confidenceBreakdown[match.confidence] || 0) + 1;
    });
    
    console.log('\n   📊 Confidence breakdown:');
    Object.entries(confidenceBreakdown).forEach(([confidence, count]) => {
        console.log(`      ${confidence}: ${count} matches`);
    });
    
    return { matches, unmatchedApiLeads };
}

async function updateMatchedLeads() {
    const client = await db.pool.connect();
    
    try {
        console.log('🚀 Starting enhanced API matching process...\n');
        
        // Fetch all API lost leads
        const allApiLeads = [];
        for (const branchId of API_BRANCH_IDS) {
            const branchLeads = await fetchLostLeadsFromAPI(branchId);
            allApiLeads.push(...branchLeads);
        }
        
        console.log(`\n📊 Total API lost leads fetched: ${allApiLeads.length}`);
        
        // Fetch ALL database leads (not just lost ones)
        const dbLeads = await getAllDatabaseLeads();
        
        // Find matches
        const { matches, unmatchedApiLeads } = findMatches(dbLeads, allApiLeads);
        
        if (matches.length === 0) {
            console.log('\n❌ No matches found to update.');
            return;
        }
        
        console.log(`\n🔄 Updating ${matches.length} matched leads...`);
        
        await client.query('BEGIN');
        
        let updatedCount = 0;
        let skippedCount = 0;
        
        for (const match of matches) {
            const { api_lead, db_lead, match_type, confidence } = match;
            
            try {
                // Check if this lead was already matched
                const wasAlreadyMatched = db_lead.matched;
                
                const updateQuery = `
                    UPDATE leads_dashboard.lead 
                    SET 
                        final_proposal_amount = $1,
                        retail_cost = $2,
                        discount_provided = $3,
                        proposal_tm = $4,
                        matched = true
                    WHERE id = $5
                `;
                
                await client.query(updateQuery, [
                    api_lead.final_price,
                    api_lead.retail_cost,
                    api_lead.discount_provided,
                    api_lead.true_cost,
                    db_lead.db_id
                ]);
                
                updatedCount++;
                
                const statusIcon = wasAlreadyMatched ? '🔄' : '✅';
                const statusText = wasAlreadyMatched ? 'RE-MATCHED' : 'NEW MATCH';
                
                console.log(`   ${statusIcon} ${statusText} (${confidence}): ${db_lead.name} [${db_lead.lead_status}] -> API: ${api_lead.name} (${match_type})`);
                
            } catch (error) {
                console.error(`   ❌ Error updating lead ${db_lead.db_id}:`, error.message);
                skippedCount++;
            }
        }
        
        await client.query('COMMIT');
        
        console.log(`\n🎉 Update complete!`);
        console.log(`   ✅ Successfully updated: ${updatedCount} leads`);
        console.log(`   ❌ Skipped due to errors: ${skippedCount} leads`);
        console.log(`   📊 Unmatched API leads: ${unmatchedApiLeads.length}`);
        
        // Show summary by branch
        console.log('\n📊 Summary by branch:');
        const branchSummary = {};
        matches.forEach(match => {
            const branch = match.db_lead.branch_name;
            if (!branchSummary[branch]) {
                branchSummary[branch] = { total: 0, new: 0, rematched: 0 };
            }
            branchSummary[branch].total++;
            if (match.db_lead.matched) {
                branchSummary[branch].rematched++;
            } else {
                branchSummary[branch].new++;
            }
        });
        
        Object.entries(branchSummary).forEach(([branch, stats]) => {
            console.log(`   ${branch}: ${stats.total} total (${stats.new} new, ${stats.rematched} re-matched)`);
        });
        
        // Show status breakdown of matched leads
        console.log('\n📊 Status breakdown of matched database leads:');
        const statusBreakdown = {};
        matches.forEach(match => {
            const status = match.db_lead.lead_status || 'No Status';
            statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
        });
        
        Object.entries(statusBreakdown).forEach(([status, count]) => {
            console.log(`   ${status}: ${count} matches`);
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error during update process:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run the update
if (require.main === module) {
    updateMatchedLeads()
        .then(() => {
            console.log('\n✅ Script completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = { updateMatchedLeads }; 