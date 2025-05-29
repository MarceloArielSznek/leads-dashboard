const https = require('https');
const db = require('../config/database');
const fs = require('fs');

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
    
    const state = cityStateParts.pop() || '';
    const city = cityStateParts.join(' ') || '';
    
    return { street, city, state, zip_code };
}

function addressesMatch(dbAddress, apiAddress) {
    const dbNormalized = normalizeAddress(dbAddress.street + ' ' + dbAddress.city);
    const apiParsed = parseApiAddress(apiAddress);
    const apiNormalized = normalizeAddress(apiParsed.street + ' ' + apiParsed.city);
    
    if (dbNormalized && apiNormalized && dbNormalized.length > 5 && apiNormalized.length > 5) {
        if (dbNormalized === apiNormalized) return true;
        if (dbNormalized.includes(apiNormalized) || apiNormalized.includes(dbNormalized)) return true;
        
        const dbStreetNum = dbAddress.street.match(/^\d+/);
        const apiStreetNum = apiParsed.street.match(/^\d+/);
        
        if (dbStreetNum && apiStreetNum && dbStreetNum[0] === apiStreetNum[0]) {
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

function findMatchesPerBranch(dbLeads, apiLeads, branchName) {
    const branchDbLeads = dbLeads.filter(lead => lead.branch_name === branchName);
    const branchApiLeads = apiLeads.filter(lead => lead.branch_name === branchName);
    
    const matches = [];
    const dbOnlyLeads = [];
    const apiOnlyLeads = [];
    
    const matchedDbIds = new Set();
    const matchedApiIds = new Set();
    
    // Phase 1: Exact name and amount matches
    for (const dbLead of branchDbLeads) {
        if (matchedDbIds.has(dbLead.db_id)) continue;
        
        const dbNameNormalized = normalizeLeadName(dbLead.name);
        
        for (const apiLead of branchApiLeads) {
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
    
    // Phase 2: Name-only matches
    for (const dbLead of branchDbLeads) {
        if (matchedDbIds.has(dbLead.db_id)) continue;
        
        const dbNameNormalized = normalizeLeadName(dbLead.name);
        
        for (const apiLead of branchApiLeads) {
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
                break;
            }
        }
    }
    
    // Phase 3: Address-based matching
    for (const dbLead of branchDbLeads) {
        if (matchedDbIds.has(dbLead.db_id)) continue;
        
        for (const apiLead of branchApiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            if (addressesMatch(dbLead.raw_address, apiLead.address)) {
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
                break;
            }
        }
    }
    
    // Collect unmatched leads
    for (const dbLead of branchDbLeads) {
        if (!matchedDbIds.has(dbLead.db_id)) {
            dbOnlyLeads.push(dbLead);
        }
    }
    
    for (const apiLead of branchApiLeads) {
        if (!matchedApiIds.has(apiLead.api_id)) {
            apiOnlyLeads.push(apiLead);
        }
    }
    
    return { matches, dbOnlyLeads, apiOnlyLeads };
}

function generateReport(branchResults) {
    let report = '# DETAILED LOST LEADS COMPARISON REPORT\n\n';
    report += `Generated on: ${new Date().toLocaleString()}\n\n`;
    
    // Summary table
    report += '## SUMMARY BY BRANCH\n\n';
    report += '| Branch | DB Leads | API Leads | Exact Matches | Name Matches | Address Matches | Total Matches | DB Only | API Only |\n';
    report += '|--------|----------|-----------|---------------|--------------|-----------------|---------------|---------|----------|\n';
    
    let totalDbLeads = 0;
    let totalApiLeads = 0;
    let totalMatches = 0;
    let totalDbOnly = 0;
    let totalApiOnly = 0;
    
    Object.entries(branchResults).forEach(([branch, result]) => {
        const exactMatches = result.matches.filter(m => m.match_type === 'name_and_amount').length;
        const nameMatches = result.matches.filter(m => m.match_type === 'name_only').length;
        const addressMatches = result.matches.filter(m => m.match_type === 'address_only').length;
        
        const dbCount = result.dbOnlyLeads.length + result.matches.length;
        const apiCount = result.apiOnlyLeads.length + result.matches.length;
        
        totalDbLeads += dbCount;
        totalApiLeads += apiCount;
        totalMatches += result.matches.length;
        totalDbOnly += result.dbOnlyLeads.length;
        totalApiOnly += result.apiOnlyLeads.length;
        
        report += `| ${branch} | ${dbCount} | ${apiCount} | ${exactMatches} | ${nameMatches} | ${addressMatches} | ${result.matches.length} | ${result.dbOnlyLeads.length} | ${result.apiOnlyLeads.length} |\n`;
    });
    
    report += `| **TOTAL** | **${totalDbLeads}** | **${totalApiLeads}** | **-** | **-** | **-** | **${totalMatches}** | **${totalDbOnly}** | **${totalApiOnly}** |\n\n`;
    
    // Detailed breakdown per branch
    Object.entries(branchResults).forEach(([branch, result]) => {
        report += `## ${branch.toUpperCase()}\n\n`;
        
        const exactMatches = result.matches.filter(m => m.match_type === 'name_and_amount');
        const nameMatches = result.matches.filter(m => m.match_type === 'name_only');
        const addressMatches = result.matches.filter(m => m.match_type === 'address_only');
        
        // Exact matches
        if (exactMatches.length > 0) {
            report += `### Exact Matches (${exactMatches.length})\n\n`;
            exactMatches.forEach((match, index) => {
                report += `${index + 1}. **${match.db_lead.name}** - $${match.db_lead.final_proposal_amount}\n`;
                report += `   - DB ID: ${match.db_lead.db_id}\n`;
                report += `   - API ID: ${match.api_lead.api_id}\n`;
                report += `   - Address: ${match.db_lead.address}\n\n`;
            });
        }
        
        // Name-only matches
        if (nameMatches.length > 0) {
            report += `### Name-Only Matches (${nameMatches.length})\n\n`;
            nameMatches.forEach((match, index) => {
                report += `${index + 1}. **${match.db_lead.name}**\n`;
                report += `   - DB Amount: $${match.db_lead.final_proposal_amount}\n`;
                report += `   - API Amount: $${match.api_lead.final_price}\n`;
                report += `   - Difference: $${match.amount_diff.toFixed(2)}\n`;
                report += `   - DB ID: ${match.db_lead.db_id} | API ID: ${match.api_lead.api_id}\n\n`;
            });
        }
        
        // Address-only matches
        if (addressMatches.length > 0) {
            report += `### Address-Only Matches (${addressMatches.length})\n\n`;
            addressMatches.forEach((match, index) => {
                report += `${index + 1}. ${match.name_diff}\n`;
                report += `   - DB Address: ${match.db_lead.address}\n`;
                report += `   - API Address: ${match.api_lead.address}\n`;
                report += `   - Amount Difference: $${match.amount_diff.toFixed(2)}\n`;
                report += `   - DB ID: ${match.db_lead.db_id} | API ID: ${match.api_lead.api_id}\n\n`;
            });
        }
        
        // Database-only leads
        if (result.dbOnlyLeads.length > 0) {
            report += `### Database-Only Leads (${result.dbOnlyLeads.length})\n\n`;
            result.dbOnlyLeads.forEach((lead, index) => {
                report += `${index + 1}. **${lead.name}** - $${lead.final_proposal_amount}\n`;
                report += `   - DB ID: ${lead.db_id}\n`;
                report += `   - Salesperson: ${lead.salesperson_name || 'Unknown'}\n`;
                report += `   - Address: ${lead.address}\n\n`;
            });
        }
        
        // API-only leads (would be imported)
        if (result.apiOnlyLeads.length > 0) {
            report += `### API-Only Leads - WOULD BE IMPORTED (${result.apiOnlyLeads.length})\n\n`;
            result.apiOnlyLeads.forEach((lead, index) => {
                report += `${index + 1}. **${lead.name}** - $${lead.final_price}\n`;
                report += `   - API ID: ${lead.api_id}\n`;
                report += `   - True Cost: $${lead.true_cost}\n`;
                report += `   - Labor Hours: ${lead.labor_hours}\n`;
                report += `   - Multiplier: ${lead.multiplier ? lead.multiplier.toFixed(2) : 'N/A'}\n`;
                report += `   - Address: ${lead.address}\n\n`;
            });
        }
        
        report += '---\n\n';
    });
    
    return report;
}

async function generateDetailedReport() {
    try {
        console.log('🔄 Starting detailed lost leads comparison report...\n');
        
        // Fetch existing lost leads from database
        const dbLeads = await getExistingLostLeads();
        
        // Fetch lost leads from API for all branches
        const allApiLeads = [];
        for (const branchId of API_BRANCH_IDS) {
            const branchLeads = await fetchLostLeadsFromAPI(branchId);
            allApiLeads.push(...branchLeads);
        }
        
        console.log('\n🔍 Analyzing matches per branch...');
        
        // Analyze each branch separately
        const branchResults = {};
        const allBranches = new Set([
            ...dbLeads.map(lead => lead.branch_name),
            ...allApiLeads.map(lead => lead.branch_name)
        ]);
        
        for (const branch of allBranches) {
            console.log(`   📊 Processing ${branch}...`);
            branchResults[branch] = findMatchesPerBranch(dbLeads, allApiLeads, branch);
        }
        
        // Generate report
        console.log('\n📝 Generating detailed report...');
        const report = generateReport(branchResults);
        
        // Save to file
        const filename = `lost_leads_detailed_report_${new Date().toISOString().split('T')[0]}.md`;
        fs.writeFileSync(filename, report);
        
        console.log(`\n✅ Detailed report saved to: ${filename}`);
        console.log('\n📊 Quick Summary:');
        
        Object.entries(branchResults).forEach(([branch, result]) => {
            const dbCount = result.dbOnlyLeads.length + result.matches.length;
            const apiCount = result.apiOnlyLeads.length + result.matches.length;
            console.log(`   ${branch}: ${dbCount} DB leads, ${apiCount} API leads, ${result.matches.length} matches, ${result.apiOnlyLeads.length} to import`);
        });
        
        return branchResults;
        
    } catch (error) {
        console.error('💥 Report generation failed:', error);
        throw error;
    }
}

// Run the report generation
if (require.main === module) {
    generateDetailedReport()
        .then(() => {
            console.log('\n✨ Detailed report generation completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Report generation failed:', error);
            process.exit(1);
        });
}

module.exports = { generateDetailedReport }; 