const https = require('https');

// Branch mapping from API to your database
const BRANCH_MAPPING = {
    1: 'Orange County',    // Orange -> Orange County
    3: 'San Diego',        // San Diego -> San Diego  
    4: 'Everett',          // Everett -> Everett
    5: 'Seattle/Kent',     // Seattle/Kent -> Seattle/Kent
    7: 'San Bernandino'    // San Bernardino -> San Bernandino (note spelling difference)
};

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

async function debugApiStatuses() {
    console.log('🔍 Debugging API statuses and filters...\n');
    
    // Test San Diego (Branch 3) since you mentioned it should have ~50 Lost leads
    const branchId = 3;
    const branchName = BRANCH_MAPPING[branchId];
    
    console.log(`📊 Testing ${branchName} (API Branch ${branchId}):\n`);
    
    // 1. First, let's see ALL statuses available (no filter)
    console.log('1️⃣ Fetching ALL job estimates (no status filter) - first 100:');
    try {
        const allUrl = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[branch][id][$eq]=${branchId}&pagination[start]=0&pagination[limit]=100&sort=updatedAt:desc&fields[0]=name&fields[1]=status`;
        
        const allData = await makeHttpsRequest(allUrl, {
            "accept": "application/json, text/plain, */*",
            "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
            "Referer": "https://www.attic-tech.com/"
        });
        
        const statusCounts = {};
        allData.data.forEach(lead => {
            const status = lead.attributes.status || 'Unknown';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        
        console.log(`   📈 Status breakdown (first 100 records):`);
        Object.entries(statusCounts).forEach(([status, count]) => {
            console.log(`      ${status}: ${count}`);
        });
        
    } catch (error) {
        console.error('   ❌ Error fetching all statuses:', error.message);
    }
    
    // 2. Now let's test the "Lost" filter specifically
    console.log('\n2️⃣ Fetching with "Lost" status filter:');
    try {
        const lostUrl = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[status][$eq]=Lost&filters[branch][id][$eq]=${branchId}&pagination[start]=0&pagination[limit]=100&sort=updatedAt:desc&fields[0]=name&fields[1]=status`;
        
        const lostData = await makeHttpsRequest(lostUrl, {
            "accept": "application/json, text/plain, */*",
            "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
            "Referer": "https://www.attic-tech.com/"
        });
        
        console.log(`   📊 Found ${lostData.data.length} leads with "Lost" status`);
        
        // Verify all returned leads actually have "Lost" status
        const actualStatuses = {};
        lostData.data.forEach(lead => {
            const status = lead.attributes.status || 'Unknown';
            actualStatuses[status] = (actualStatuses[status] || 0) + 1;
        });
        
        console.log(`   🔍 Actual statuses returned:`);
        Object.entries(actualStatuses).forEach(([status, count]) => {
            console.log(`      ${status}: ${count}`);
        });
        
        // Show first few lead names for verification
        if (lostData.data.length > 0) {
            console.log(`   📝 Sample "Lost" leads:`);
            lostData.data.slice(0, 5).forEach((lead, index) => {
                console.log(`      ${index + 1}. "${lead.attributes.name}" - Status: "${lead.attributes.status}"`);
            });
        }
        
    } catch (error) {
        console.error('   ❌ Error fetching Lost leads:', error.message);
    }
    
    // 3. Let's also try other possible status values
    console.log('\n3️⃣ Testing other possible status values:');
    const testStatuses = ['lost', 'LOST', 'Lost Lead', 'Declined', 'Rejected', 'Not Sold'];
    
    for (const testStatus of testStatuses) {
        try {
            const testUrl = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[status][$eq]=${encodeURIComponent(testStatus)}&filters[branch][id][$eq]=${branchId}&pagination[start]=0&pagination[limit]=10&fields[0]=name&fields[1]=status`;
            
            const testData = await makeHttpsRequest(testUrl, {
                "accept": "application/json, text/plain, */*",
                "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
                "Referer": "https://www.attic-tech.com/"
            });
            
            if (testData.data.length > 0) {
                console.log(`   ✅ "${testStatus}": ${testData.data.length} leads found`);
            } else {
                console.log(`   ❌ "${testStatus}": 0 leads found`);
            }
            
        } catch (error) {
            console.log(`   ❌ "${testStatus}": Error - ${error.message}`);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // 4. Let's check the total count with pagination
    console.log('\n4️⃣ Checking total "Lost" leads with pagination:');
    try {
        let totalLostLeads = 0;
        let start = 0;
        const limit = 100;
        let hasMoreData = true;
        
        while (hasMoreData) {
            const paginatedUrl = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[status][$eq]=Lost&filters[branch][id][$eq]=${branchId}&pagination[start]=${start}&pagination[limit]=${limit}&fields[0]=name&fields[1]=status`;
            
            const pageData = await makeHttpsRequest(paginatedUrl, {
                "accept": "application/json, text/plain, */*",
                "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
                "Referer": "https://www.attic-tech.com/"
            });
            
            const pageCount = pageData.data.length;
            totalLostLeads += pageCount;
            
            console.log(`   📄 Page ${Math.floor(start/limit) + 1}: ${pageCount} leads`);
            
            if (pageCount < limit) {
                hasMoreData = false;
            } else {
                start += limit;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        console.log(`   🎯 Total "Lost" leads in ${branchName}: ${totalLostLeads}`);
        
    } catch (error) {
        console.error('   ❌ Error with pagination:', error.message);
    }
}

// Run the debug
debugApiStatuses()
    .then(() => {
        console.log('\n✨ API status debugging completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Debug failed:', error);
        process.exit(1);
    }); 