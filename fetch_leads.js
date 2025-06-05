require('dotenv').config(); // Load .env file variables
const https = require('https');
const { Pool } = require('pg'); // For database interaction

// --- Configuration (Module Level) ---
const API_BRANCH_IDS = [1, 3, 4, 5, 7];
const API_TOKEN = process.env.ATTIC_API_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw';
const API_PAGE_SIZE = 100;
const DRY_RUN = false; // Set to false to perform actual database updates

// DB Status IDs (as per your lead_status table)
const DB_STATUS_SOLD = 1;
const DB_STATUS_LOST = 2;
const DB_STATUS_OPEN = 3;

const API_FIELDS_TO_FETCH = [
  'name', 'status', 'address', 'final_price', 'retail_cost',
  'true_cost', 'sub_services_retail_cost', // For sub_contractor_price and proposal_tm
  'publishedAt', 'updatedAt', 'createdAt' // createdAt for Rule 2
];
const apiFieldsQuery = API_FIELDS_TO_FETCH.map((field, index) => `fields[${index}]=${encodeURIComponent(field)}`).join('&');

const oneYearAgo = new Date();
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
const DATE_FILTER_ISO = oneYearAgo.toISOString();

// !!! IMPORTANT: Update with your actual database connection details !!!
const dbPool = new Pool({
  user: process.env.DB_USER, 
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10),
});
// --- End Configuration ---

// --- Helper Functions ---
function normalizeString(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()'"]/g, "").replace(/\s+/g, ' ').trim();
}

// --- API Fetching Logic ---
async function fetchAllLeadsFromAPIBranch(branchId, dateFilterIso, logMessages) {
  logMessages.push(`Fetching API leads for Branch ID: ${branchId} (updated since ${dateFilterIso})`);
  let allLeadsForBranch = [];
  let currentPage = 0;
  let totalLeadsToFetch = 0;
  let leadsFetchedSoFar = 0;

  do {
    const startOffset = currentPage * API_PAGE_SIZE;
    // Use dateFilterIso passed as argument
    const path = `/api/job-estimates?publicationState=live&filters[branch][id][$eq]=${branchId}&filters[updatedAt][$gte]=${dateFilterIso}&pagination[start]=${startOffset}&pagination[limit]=${API_PAGE_SIZE}&sort=updatedAt:desc&populate[0]=user&${apiFieldsQuery}`;
    
const options = {
  hostname: 'admin.attic-tech.com',
      path: path,
  method: 'GET',
  headers: {
        'Authorization': `Bearer ${API_TOKEN}`, // Uses module-level API_TOKEN
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://www.attic-tech.com',
    'Referer': 'https://www.attic-tech.com/',
        'User-Agent': 'Node.js Leads Sync Script'
  }
};

    try {
      const jsonData = await new Promise((resolve, reject) => {
const req = https.request(options, (res) => {
  let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              try { resolve(JSON.parse(data)); }
              catch (e) { 
                logMessages.push(`Branch ${branchId} - JSON Parse Error: ${e.message}`);
                reject(e); 
              }
            } else {
              logMessages.push(`Branch ${branchId} - API Error. Status: ${res.statusCode}, Data: ${data.substring(0, 200)}`);
              reject(new Error(`API request for Branch ${branchId} failed: ${res.statusCode}`));
            }
          });
        });
        req.on('error', (e) => { 
          logMessages.push(`Branch ${branchId} - Request Error: ${e.message}`);
          reject(e); 
        });
        req.end();
      });

      if (jsonData.data && Array.isArray(jsonData.data)) {
        jsonData.data.forEach(lead => allLeadsForBranch.push(lead));
        leadsFetchedSoFar += jsonData.data.length;

        if (currentPage === 0) {
          totalLeadsToFetch = jsonData.meta?.pagination?.total || 0;
          logMessages.push(`Branch ${branchId} - Total API leads to fetch (matching criteria): ${totalLeadsToFetch}`);
        }
        logMessages.push(`Branch ${branchId} - Page ${currentPage + 1}: Fetched ${jsonData.data.length}. So far: ${leadsFetchedSoFar}/${totalLeadsToFetch}`);
        if (!jsonData.data.length || leadsFetchedSoFar >= totalLeadsToFetch) break;
      } else {
        logMessages.push(`Branch ${branchId} - No data array or unexpected format for page ${currentPage + 1}.`);
        break;
      }
      currentPage++;
      if (leadsFetchedSoFar < totalLeadsToFetch) {
          await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      logMessages.push(`Branch ${branchId} - Error fetching page ${currentPage + 1}: ${error.message}`);
      // errorsArray.push(`Branch ${branchId} fetch error: ${error.message}`); // Add to a dedicated errors array in summary
      break; 
    }
  } while (leadsFetchedSoFar < totalLeadsToFetch && totalLeadsToFetch > 0);
  logMessages.push(`Finished API fetch for Branch ${branchId}. Retrieved ${allLeadsForBranch.length} leads.`);
  return allLeadsForBranch;
}

// --- Database Fetching Logic ---
async function fetchAllLeadsFromDB(skipAlreadyMatchedDBLeads, logMessages) {
  logMessages.push('Fetching leads from the local database...');
  let query = `
    SELECT
      l.id as db_lead_id, l.name as db_lead_name, l.lead_status_id,
      l.sub_contractor_price, l.proposal_tm, l.matched,
      c.first_name, c.last_name,
      a.street as db_street, a.city as db_city, a.state as db_state, a.zip_code as db_zip_code
    FROM leads_dashboard.lead l
    LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
    LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
  `;
  if (skipAlreadyMatchedDBLeads) {
    query += ' WHERE (l.matched = false OR l.matched IS NULL)';
  }
  query += ' ORDER BY l.id;';
  
  let client;
  try {
    client = await dbPool.connect();
    const { rows } = await client.query(query);
    logMessages.push(`Fetched ${rows.length} leads from the database.` + (skipAlreadyMatchedDBLeads ? ' (skipped already matched leads)' : ''));
    return rows;
  } catch (error) {
    logMessages.push(`Error fetching leads from database: ${error.message}`);
    // errorsArray.push(`DB fetch error: ${error.message}`);
    return [];
  } finally {
    if (client) client.release();
  }
}

// --- Main Sync Process Function ---
async function runLeadSyncProcess(config) {
  const { 
    daysToLookBack, 
    apiBranchIds,
    matchByName, 
    matchByAddress, 
    skipAlreadyMatchedDBLeads, 
    isDryRun 
  } = config;

  const resultsSummary = {
    apiLeadsFetched: 0,
    dbLeadsScanned: 0,
    matchesFound: 0,
    leadsUpdated: 0, // For live run
    leadsWouldUpdate: 0, // For dry run
    statusChanges: 0, // For both, context given by dry/live run
    logMessages: [],
    errors: []
  };

  resultsSummary.logMessages.push('Starting API and DB lead synchronization process...');
  resultsSummary.logMessages.push(`Dry Run: ${isDryRun}`);
  resultsSummary.logMessages.push(`Configuration: Days Back=${daysToLookBack}, Branches=${apiBranchIds.join(',')}, MatchByName=${matchByName}, MatchByAddress=${matchByAddress}, SkipMatched=${skipAlreadyMatchedDBLeads}`);


  const dateFilter = new Date();
  dateFilter.setDate(dateFilter.getDate() - daysToLookBack);
  const dateFilterIso = dateFilter.toISOString();

  resultsSummary.logMessages.push(`Fetching API leads updated since: ${dateFilterIso}`);
  
  let allApiLeadsCombined = [];
  for (const branchId of apiBranchIds) {
    try {
      const branchApiLeads = await fetchAllLeadsFromAPIBranch(branchId, dateFilterIso, resultsSummary.logMessages);
      allApiLeadsCombined.push(...branchApiLeads);
    } catch (e) {
      resultsSummary.errors.push(`Failed to fetch leads for branch ${branchId}: ${e.message}`);
    }
  }
  resultsSummary.apiLeadsFetched = allApiLeadsCombined.length;
  resultsSummary.logMessages.push(`Total API leads fetched from all configured branches: ${resultsSummary.apiLeadsFetched}`);

  // Sub contractor cost analysis (can be kept if useful for logs)
  let leadsWithSubCostCount = 0;
  let leadsWithPositiveSubCostCount = 0;
  allApiLeadsCombined.forEach(apiLead => {
    if (apiLead.attributes && apiLead.attributes.sub_services_retail_cost !== null && apiLead.attributes.sub_services_retail_cost !== undefined) {
      leadsWithSubCostCount++;
      if (parseFloat(apiLead.attributes.sub_services_retail_cost) > 0) {
        leadsWithPositiveSubCostCount++;
      }
    }
  });
  resultsSummary.logMessages.push(`--- API Lead Sub Contractor Cost Analysis ---`);
  resultsSummary.logMessages.push(`Number of API leads with a sub_services_retail_cost value (non-null): ${leadsWithSubCostCount}`);
  resultsSummary.logMessages.push(`Number of API leads with a sub_services_retail_cost value > 0: ${leadsWithPositiveSubCostCount}`);


  const allDbLeads = await fetchAllLeadsFromDB(skipAlreadyMatchedDBLeads, resultsSummary.logMessages);
  resultsSummary.dbLeadsScanned = allDbLeads.length;

  if (!allApiLeadsCombined.length) {
    resultsSummary.logMessages.push('No API leads fetched. Exiting comparison and update process.');
    return resultsSummary;
  }
  if (!allDbLeads.length && !skipAlreadyMatchedDBLeads) {
    resultsSummary.logMessages.push('No DB leads fetched. Exiting comparison and update process.');
    return resultsSummary;
  }
   if (!allDbLeads.length && skipAlreadyMatchedDBLeads) {
     resultsSummary.logMessages.push('No DB leads fetched (possibly all were already matched and skipped).');
     return resultsSummary;
   }

  const matchedPairs = []; // Retained for potential summary, not for driving updates.
  const matchedDbLeadIds = new Set(); 

  resultsSummary.logMessages.push('Starting comparison and immediate update processing...');
  
  for (const apiLead of allApiLeadsCombined) {
    if (!apiLead.attributes) {
      resultsSummary.logMessages.push(`Skipping API lead with no attributes. ID: ${apiLead.id || 'N/A'}`);
      continue; 
    }
    const normalizedApiName = normalizeString(apiLead.attributes.name);
    const normalizedApiAddress = normalizeString(apiLead.attributes.address);

    for (const dbLead of allDbLeads) {
      if (matchedDbLeadIds.has(dbLead.db_lead_id)) continue; // Already matched this DB lead, skip

      const normalizedDbLeadName = normalizeString(dbLead.db_lead_name);
      const fullDbAddress = normalizeString(`${dbLead.db_street || ''} ${dbLead.db_city || ''} ${dbLead.db_state || ''}`.trim());

      let isMatch = false;
      let matchType = '';

      // Match by Name
      if (matchByName && normalizedApiName && normalizedDbLeadName && normalizedApiName === normalizedDbLeadName) {
        isMatch = true;
        matchType = 'Name';
      }
      // Match by Address (if not already matched by name)
      else if (matchByAddress && normalizedApiAddress && fullDbAddress) {
        if (normalizedApiAddress.length > 5 && fullDbAddress.length > 5 && 
            (normalizedApiAddress.includes(fullDbAddress) || fullDbAddress.includes(normalizedApiAddress))) {
          isMatch = true;
          matchType = 'Address';
        }
      }

      if (isMatch) {
        resultsSummary.matchesFound++;
        // matchedPairs.push({ apiLead, dbLead, matchType }); // Optionally keep for a final summary list
        matchedDbLeadIds.add(dbLead.db_lead_id); // Mark DB lead as processed for matching
        resultsSummary.logMessages.push(`Match found by ${matchType}: API Lead (ID: ${apiLead.id}, Name: "${apiLead.attributes.name}") matched DB Lead ID ${dbLead.db_lead_id} (Name: "${dbLead.db_lead_name}").`);

        // --- START LEAD UPDATE LOGIC ---
        let targetLeadStatusId = dbLead.lead_status_id; // Default to current DB status
        const currentDbStatusId = dbLead.lead_status_id;
        const apiStatus = apiLead.attributes.status;
        const apiCreatedAt = new Date(apiLead.attributes.createdAt);

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Rule S1: Dominant Sold Status
        if (apiStatus === 'Sold' || currentDbStatusId === DB_STATUS_SOLD) {
            targetLeadStatusId = DB_STATUS_SOLD;
        }
        // Rule S2: API "Lost" Status (only if S1 didn't apply)
        else if (apiStatus === 'Lost') {
            targetLeadStatusId = DB_STATUS_LOST;
        }
        // Rule S3: Old API "Open" Leads to "Lost" (only if S1, S2 didn't apply)
        else if (apiStatus !== 'Sold' && apiStatus !== 'Lost' && apiCreatedAt < thirtyDaysAgo) {
            targetLeadStatusId = DB_STATUS_LOST;
        }
        // Rule S4: API "Open" Leads to "Open" (only if S1, S2, S3 didn't apply)
        else if (apiStatus !== 'Sold' && apiStatus !== 'Lost') {
            targetLeadStatusId = DB_STATUS_OPEN;
        }

        const subContractorPrice = parseFloat(apiLead.attributes.sub_services_retail_cost) || 0.00;
        const proposalTm = parseFloat(apiLead.attributes.true_cost) || 0.00;
        
        const currentDbSubContractorPrice = parseFloat(dbLead.sub_contractor_price) || 0.00;
        const currentDbProposalTm = parseFloat(dbLead.proposal_tm) || 0.00;

        const needsDBUpdate = (
            targetLeadStatusId !== currentDbStatusId ||
            currentDbSubContractorPrice.toFixed(2) !== subContractorPrice.toFixed(2) || // Compare with fixed precision
            currentDbProposalTm.toFixed(2) !== proposalTm.toFixed(2) ||
            dbLead.matched !== true 
        );

        if (needsDBUpdate) {
            const statusChangeDescription = targetLeadStatusId !== currentDbStatusId ? `status ${currentDbStatusId} -> ${targetLeadStatusId}` : 'status unchanged';
            const subPriceChangeDescription = currentDbSubContractorPrice.toFixed(2) !== subContractorPrice.toFixed(2) ? `sub_price ${currentDbSubContractorPrice.toFixed(2)} -> ${subContractorPrice.toFixed(2)}` : 'sub_price unchanged';
            const tmPriceChangeDescription = currentDbProposalTm.toFixed(2) !== proposalTm.toFixed(2) ? `tm_price ${currentDbProposalTm.toFixed(2)} -> ${proposalTm.toFixed(2)}` : 'tm_price unchanged';
            const matchedFlagChangeDescription = dbLead.matched !== true ? `matched flag -> true` : 'matched flag unchanged (already true)';
            const updateSummary = `Changes: ${statusChangeDescription}, ${subPriceChangeDescription}, ${tmPriceChangeDescription}, ${matchedFlagChangeDescription}.`;

            if (isDryRun) {
                resultsSummary.leadsWouldUpdate++;
                if (targetLeadStatusId !== currentDbStatusId) {
                    resultsSummary.statusChanges++;
                }
                resultsSummary.logMessages.push(`DRY RUN: Would update DB Lead ID ${dbLead.db_lead_id}. ${updateSummary}`);
            } else {
                try {
                    const updateQuery = `
                        UPDATE leads_dashboard.lead
                        SET lead_status_id = $1, sub_contractor_price = $2, proposal_tm = $3, matched = true, updated_at = NOW()
                        WHERE id = $4;
                    `;
                    await dbPool.query(updateQuery, [targetLeadStatusId, subContractorPrice, proposalTm, dbLead.db_lead_id]);
                    resultsSummary.leadsUpdated++;
                    if (targetLeadStatusId !== currentDbStatusId) {
                        resultsSummary.statusChanges++;
                    }
                    resultsSummary.logMessages.push(`LIVE RUN: Updated DB Lead ID ${dbLead.db_lead_id}. ${updateSummary}`);
                } catch (updateError) {
                    resultsSummary.errors.push(`Error updating DB Lead ID ${dbLead.db_lead_id}: ${updateError.message}`);
                    resultsSummary.logMessages.push(`ERROR: Failed to update DB Lead ID ${dbLead.db_lead_id}: ${updateError.message}. Attempted values: status_id=${targetLeadStatusId}, sub_price=${subContractorPrice}, tm_price=${proposalTm}, id=${dbLead.db_lead_id}`);
                }
            }
        } else {
            resultsSummary.logMessages.push(`No update action needed for DB Lead ID ${dbLead.db_lead_id} (data and matched status consistent with API and rules).`);
        }
        // --- END LEAD UPDATE LOGIC ---

        break; // Found a match for this apiLead, move to the next apiLead
      }
    } // End DB leads loop
  } // End API leads for...of loop

  resultsSummary.logMessages.push('--- Synchronization Summary ---');
  resultsSummary.logMessages.push(`Total API leads fetched: ${resultsSummary.apiLeadsFetched}`);
  resultsSummary.logMessages.push(`Total DB leads scanned` + (skipAlreadyMatchedDBLeads ? ' (excluding already matched)' : '') + `: ${resultsSummary.dbLeadsScanned}`);
  resultsSummary.logMessages.push(`Number of API leads that found a match in DB: ${resultsSummary.matchesFound}`);
  if (isDryRun) {
    resultsSummary.logMessages.push(`Number of DB leads that WOULD BE updated (Dry Run): ${resultsSummary.leadsWouldUpdate}`);
    resultsSummary.logMessages.push(`Number of DB leads that WOULD HAVE status changed (Dry Run): ${resultsSummary.statusChanges}`);
  } else {
    resultsSummary.logMessages.push(`Number of DB leads updated: ${resultsSummary.leadsUpdated}`);
    resultsSummary.logMessages.push(`Number of DB leads that HAD status changed: ${resultsSummary.statusChanges}`);
  }
  if(resultsSummary.errors.length > 0){
      resultsSummary.logMessages.push(`Encountered ${resultsSummary.errors.length} errors during the process. Check 'errors' array in summary for details.`);
  }
  resultsSummary.logMessages.push('Lead synchronization process finished.');
  return resultsSummary;
}

// Remove or comment out the old main() call and direct execution logic
// async function main() { ... }
// main().catch(console.error); // If it was run directly

module.exports = { runLeadSyncProcess };

// Block for manual execution
if (require.main === module) {
    console.log("Running fetch_leads.js script manually...");
    // Define a default configuration for manual runs
    const defaultConfig = {
        daysToLookBack: 30, 
        apiBranchIds: [1, 3, 4, 5, 7],
        matchByName: true,
        matchByAddress: true,
        skipAlreadyMatchedDBLeads: false,
        isDryRun: true // ALWAYS default to dry run for safety in manual execution
    };

    console.log("Using default manual configuration:", JSON.stringify(defaultConfig, null, 2));

    runLeadSyncProcess(defaultConfig)
        .then(summary => {
            console.log("\n--- MANUAL EXECUTION COMPLETE ---");
            console.log("Log Messages:");
            summary.logMessages.forEach(msg => {
                if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
                    console.error(msg);
                } else if (msg.toLowerCase().includes('dry run')) {
                    console.warn(msg); // Yellow for warnings/dry run info
                } else {
                    console.log(msg);
                }
            });

            if (summary.errors && summary.errors.length > 0) {
                console.error("\n--- ERRORS ENCOUNTERED ---");
                summary.errors.forEach(err => console.error(err));
            }
            
            console.log("\n--- FINAL SUMMARY (from returned object) ---");
            console.log(`  API Leads Fetched: ${summary.apiLeadsFetched}`);
            console.log(`  DB Leads Scanned: ${summary.dbLeadsScanned}`);
            console.log(`  Matches Found: ${summary.matchesFound}`);
            if (summary.hasOwnProperty('leadsWouldUpdate')) { // Check if property exists
                 console.log(`  Leads Would Be Updated (Dry Run): ${summary.leadsWouldUpdate}`);
            }
            if (summary.hasOwnProperty('leadsUpdated')) { // Check if property exists
                console.log(`  Leads Updated (Live Run): ${summary.leadsUpdated}`);
            }
            if (summary.hasOwnProperty('statusChanges')) {
                console.log(`  Status Changes (would occur or did occur): ${summary.statusChanges}`);
            }
        })
        .catch(error => {
            console.error("\n--- MANUAL EXECUTION FAILED ---");
            console.error("Unhandled error during manual script execution:", error);
        })
        .finally(async () => {
            try {
                await dbPool.end(); 
                console.log("Database pool closed after manual execution.");
            } catch (e) {
                console.error("Error closing database pool after manual execution:", e);
            }
        });
}