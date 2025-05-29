import fetch from 'node-fetch';

const branchIds = [1, 3, 4, 5, 7];

async function fetchLostLeads(branchId) {
  const url = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[status][$eq]=Lost&filters[branch][id][$eq]=${branchId}&pagination[start]=0&pagination[limit]=1000&sort=updatedAt:desc&populate[0]=customer_info&populate[1]=branch_configuration&fields[0]=name&fields[1]=status&fields[2]=true_cost&fields[3]=labor_hours&fields[4]=address&fields[5]=retail_cost&fields[6]=final_price&fields[7]=discount_provided`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        "accept": "application/json, text/plain, */*",
        "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
        "Referer": "https://www.attic-tech.com/"
      }
    });

    const data = await res.json();

    data.data.forEach(lead => {
      const a = lead.attributes;
      if (a.status !== "Lost") return;

      const multiplier = a.true_cost > 0 ? a.final_price / a.true_cost : null;

      const cleanLead = {
        branch_id: branchId,
        id: lead.id,
        name: a.name,
        status: a.status,
        true_cost: a.true_cost,
        labor_hours: a.labor_hours,
        address: a.address,
        retail_cost: a.retail_cost,
        final_price: a.final_price,
        discount_provided: a.discount_provided,
        multiplier: multiplier,
        customer_info: a.customer_info?.data?.attributes || null,
        branch_configuration: a.branch_configuration?.data?.attributes || null
      };

      console.log(JSON.stringify(cleanLead, null, 2));
    });

  } catch (err) {
    console.error(`❌ Error fetching branch ${branchId}:`, err.message);
  }
}

async function main() {
  for (const id of branchIds) {
    await fetchLostLeads(id);
  }
}

main();