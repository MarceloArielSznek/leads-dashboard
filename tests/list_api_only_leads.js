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

function findApiOnlyLeads(dbLeads, apiLeads) {
    const apiOnlyLeads = [];
    const matchedApiIds = new Set();
    
    console.log('🔍 Finding matches to identify API-only leads...');
    
    // Phase 1: Exact name and amount matches
    for (const dbLead of dbLeads) {
        const dbNameNormalized = normalizeLeadName(dbLead.name);
        
        for (const apiLead of apiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            const apiNameNormalized = normalizeLeadName(apiLead.name);
            
            if (dbNameNormalized === apiNameNormalized && 
                Math.abs(dbLead.final_proposal_amount - apiLead.final_price) < 0.01) {
                matchedApiIds.add(apiLead.api_id);
                break;
            }
        }
    }
    
    // Phase 2: Name-only matches
    for (const dbLead of dbLeads) {
        const dbNameNormalized = normalizeLeadName(dbLead.name);
        
        for (const apiLead of apiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            const apiNameNormalized = normalizeLeadName(apiLead.name);
            
            if (dbNameNormalized === apiNameNormalized) {
                matchedApiIds.add(apiLead.api_id);
                break;
            }
        }
    }
    
    // Phase 3: Address-based matching
    for (const dbLead of dbLeads) {
        for (const apiLead of apiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            if (dbLead.branch_name === apiLead.branch_name && 
                addressesMatch(dbLead.raw_address, apiLead.address)) {
                matchedApiIds.add(apiLead.api_id);
                break;
            }
        }
    }
    
    // Collect unmatched API leads
    for (const apiLead of apiLeads) {
        if (!matchedApiIds.has(apiLead.api_id)) {
            apiOnlyLeads.push(apiLead);
        }
    }
    
    return apiOnlyLeads;
}

function generateApiOnlyReport(apiOnlyLeads) {
    let report = '# API-ONLY LEADS TO IMPORT\n\n';
    report += `Generated on: ${new Date().toLocaleString()}\n\n`;
    report += `Total leads to import: **${apiOnlyLeads.length}**\n\n`;
    
    // Group by branch
    const leadsByBranch = {};
    apiOnlyLeads.forEach(lead => {
        if (!leadsByBranch[lead.branch_name]) {
            leadsByBranch[lead.branch_name] = [];
        }
        leadsByBranch[lead.branch_name].push(lead);
    });
    
    // Summary table
    report += '## SUMMARY BY BRANCH\n\n';
    report += '| Branch | Count | Total Value | Avg Value | Total True Cost | Avg Multiplier |\n';
    report += '|--------|-------|-------------|-----------|-----------------|----------------|\n';
    
    let grandTotal = 0;
    let grandTrueCost = 0;
    let totalCount = 0;
    
    Object.entries(leadsByBranch).forEach(([branch, leads]) => {
        const totalValue = leads.reduce((sum, lead) => sum + lead.final_price, 0);
        const totalTrueCost = leads.reduce((sum, lead) => sum + lead.true_cost, 0);
        const avgValue = totalValue / leads.length;
        const avgMultiplier = leads.filter(l => l.multiplier).reduce((sum, lead, _, arr) => sum + lead.multiplier / arr.length, 0);
        
        grandTotal += totalValue;
        grandTrueCost += totalTrueCost;
        totalCount += leads.length;
        
        report += `| ${branch} | ${leads.length} | $${totalValue.toLocaleString()} | $${avgValue.toLocaleString()} | $${totalTrueCost.toLocaleString()} | ${avgMultiplier.toFixed(2)} |\n`;
    });
    
    const grandAvgValue = grandTotal / totalCount;
    const grandAvgMultiplier = grandTotal / grandTrueCost;
    
    report += `| **TOTAL** | **${totalCount}** | **$${grandTotal.toLocaleString()}** | **$${grandAvgValue.toLocaleString()}** | **$${grandTrueCost.toLocaleString()}** | **${grandAvgMultiplier.toFixed(2)}** |\n\n`;
    
    // Detailed listings by branch
    Object.entries(leadsByBranch).forEach(([branch, leads]) => {
        report += `## ${branch.toUpperCase()} (${leads.length} leads)\n\n`;
        
        // Sort by final price descending
        leads.sort((a, b) => b.final_price - a.final_price);
        
        leads.forEach((lead, index) => {
            report += `### ${index + 1}. ${lead.name}\n\n`;
            report += `- **API ID:** ${lead.api_id}\n`;
            report += `- **Final Price:** $${lead.final_price.toLocaleString()}\n`;
            report += `- **True Cost:** $${lead.true_cost.toLocaleString()}\n`;
            report += `- **Retail Cost:** $${lead.retail_cost.toLocaleString()}\n`;
            report += `- **Labor Hours:** ${lead.labor_hours}\n`;
            report += `- **Discount:** $${lead.discount_provided.toLocaleString()}\n`;
            report += `- **Multiplier:** ${lead.multiplier ? lead.multiplier.toFixed(2) : 'N/A'}\n`;
            report += `- **Profit Margin:** ${lead.true_cost > 0 ? (((lead.final_price - lead.true_cost) / lead.final_price) * 100).toFixed(1) + '%' : 'N/A'}\n`;
            report += `- **Address:** ${lead.address}\n`;
            report += `- **Status:** ${lead.status}\n\n`;
        });
        
        report += '---\n\n';
    });
    
    // CSV format for easy import
    report += '## CSV FORMAT\n\n';
    report += '```csv\n';
    report += 'API_ID,Branch,Name,Final_Price,True_Cost,Labor_Hours,Multiplier,Address,Status\n';
    
    apiOnlyLeads.forEach(lead => {
        const csvLine = [
            lead.api_id,
            `"${lead.branch_name}"`,
            `"${lead.name}"`,
            lead.final_price,
            lead.true_cost,
            lead.labor_hours,
            lead.multiplier ? lead.multiplier.toFixed(2) : '',
            `"${lead.address}"`,
            `"${lead.status}"`
        ].join(',');
        report += csvLine + '\n';
    });
    
    report += '```\n\n';
    
    return report;
}

async function listApiOnlyLeads() {
    try {
        console.log('🔄 Starting API-only leads extraction...\n');
        
        // Fetch existing lost leads from database
        const dbLeads = await getExistingLostLeads();
        
        // Fetch lost leads from API for all branches
        const allApiLeads = [];
        for (const branchId of API_BRANCH_IDS) {
            const branchLeads = await fetchLostLeadsFromAPI(branchId);
            allApiLeads.push(...branchLeads);
        }
        
        console.log('\n🔍 Identifying API-only leads...');
        
        // Find API-only leads
        const apiOnlyLeads = findApiOnlyLeads(dbLeads, allApiLeads);
        
        console.log(`\n✅ Found ${apiOnlyLeads.length} API-only leads to import`);
        
        // Generate report
        console.log('\n📝 Generating API-only leads report...');
        const report = generateApiOnlyReport(apiOnlyLeads);
        
        // Save to file
        const filename = `api_only_leads_to_import_${new Date().toISOString().split('T')[0]}.md`;
        fs.writeFileSync(filename, report);
        
        console.log(`\n✅ API-only leads report saved to: ${filename}`);
        
        // Console summary
        console.log('\n📊 Summary by Branch:');
        const leadsByBranch = {};
        apiOnlyLeads.forEach(lead => {
            if (!leadsByBranch[lead.branch_name]) {
                leadsByBranch[lead.branch_name] = [];
            }
            leadsByBranch[lead.branch_name].push(lead);
        });
        
        Object.entries(leadsByBranch).forEach(([branch, leads]) => {
            const totalValue = leads.reduce((sum, lead) => sum + lead.final_price, 0);
            console.log(`   ${branch}: ${leads.length} leads, $${totalValue.toLocaleString()} total value`);
        });
        
        const grandTotal = apiOnlyLeads.reduce((sum, lead) => sum + lead.final_price, 0);
        console.log(`   TOTAL: ${apiOnlyLeads.length} leads, $${grandTotal.toLocaleString()} total value`);
        
        return apiOnlyLeads;
        
    } catch (error) {
        console.error('💥 API-only leads extraction failed:', error);
        throw error;
    }
}

// Run the extraction
if (require.main === module) {
    listApiOnlyLeads()
        .then(() => {
            console.log('\n✨ API-only leads extraction completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Extraction failed:', error);
            process.exit(1);
        });
}

module.exports = { listApiOnlyLeads }; 