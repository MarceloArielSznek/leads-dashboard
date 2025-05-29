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

// Calculate date 60 days ago for API filtering
function getDateSixtyDaysAgo() {
    const date = new Date();
    date.setDate(date.getDate() - 60);
    return date.toISOString(); // Full ISO format for API
}

async function testOlderLeadsAPI() {
    const sixtyDaysAgo = getDateSixtyDaysAgo();
    console.log(`📅 Testing API for leads CREATED more than 60 days ago`);
    console.log(`   Looking for API leads created before: ${sixtyDaysAgo.split('T')[0]}`);
    
    // Test with just one branch first (San Diego - smaller dataset)
    const branchId = 3;
    const limit = 10; // Small limit for testing
    
    try {
        console.log(`\n📡 Testing older leads from ${BRANCH_MAPPING[branchId]} (API Branch ${branchId})...`);
        
        // Test the API call - using createdAt filter (not updatedAt)
        const url = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[branch][id][$eq]=${branchId}&filters[createdAt][$lt]=${sixtyDaysAgo}&pagination[start]=0&pagination[limit]=${limit}&sort=createdAt:desc&populate[0]=customer_info&populate[1]=branch_configuration&fields[0]=name&fields[1]=status&fields[2]=true_cost&fields[3]=labor_hours&fields[4]=address&fields[5]=retail_cost&fields[6]=final_price&fields[7]=discount_provided&fields[8]=updatedAt&fields[9]=createdAt`;

        console.log(`\n🔗 API URL (first 150 chars): ${url.substring(0, 150)}...`);

        const data = await makeHttpsRequest(url, {
            "accept": "application/json, text/plain, */*",
            "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
            "Referer": "https://www.attic-tech.com/"
        });

        console.log(`\n📊 API Response:`);
        console.log(`   Total results: ${data.meta?.pagination?.total || 'unknown'}`);
        console.log(`   Page results: ${data.data?.length || 0}`);
        
        if (data.data && data.data.length > 0) {
            console.log(`\n📋 Sample leads (first 3):`);
            data.data.slice(0, 3).forEach((lead, index) => {
                const a = lead.attributes;
                
                // Calculate age in days
                const createdDate = new Date(a.createdAt);
                const now = new Date();
                const ageInDays = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
                
                console.log(`   ${index + 1}. ${a.name || 'No name'}`);
                console.log(`      Status: ${a.status}`);
                console.log(`      Created: ${a.createdAt} (${ageInDays} days ago)`);
                console.log(`      Updated: ${a.updatedAt}`);
                console.log(`      Final Price: $${a.final_price || 0}`);
                console.log(`      Address: ${a.address || 'No address'}`);
                console.log('');
            });
            
            // Count by status
            const statusCounts = {};
            data.data.forEach(lead => {
                const status = lead.attributes.status || 'No Status';
                statusCounts[status] = (statusCounts[status] || 0) + 1;
            });
            
            console.log(`📊 Status breakdown (sample of ${data.data.length}):`);
            Object.entries(statusCounts).forEach(([status, count]) => {
                console.log(`   ${status}: ${count} leads`);
            });
            
            // Show age statistics
            const ages = data.data.map(lead => {
                const createdDate = new Date(lead.attributes.createdAt);
                const now = new Date();
                return Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
            });
            
            if (ages.length > 0) {
                const avgAge = Math.round(ages.reduce((a, b) => a + b, 0) / ages.length);
                const minAge = Math.min(...ages);
                const maxAge = Math.max(...ages);
                
                console.log(`\n📅 Age statistics:`);
                console.log(`   Average age: ${avgAge} days`);
                console.log(`   Age range: ${minAge} - ${maxAge} days`);
                console.log(`   All leads older than 60 days: ${ages.every(age => age > 60) ? 'YES ✅' : 'NO ❌'}`);
            }
            
        } else {
            console.log(`❌ No older leads found or API error`);
            console.log(`Full response:`, JSON.stringify(data, null, 2));
        }

    } catch (error) {
        console.error(`❌ Error testing API:`, error.message);
        console.error(`Full error:`, error);
    }
}

// Run the test
testOlderLeadsAPI()
    .then(() => {
        console.log('\n✅ Test completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    }); 