import fetch from 'node-fetch';

const branchIds = [1, 3, 4, 5, 7];

async function fetchLostEstimates(branchId) {
  const url = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[branch][id][$eq]=${branchId}&pagination[start]=0&pagination[limit]=1000&sort=updatedAt:desc&populate[0]=branch_configuration&fields[0]=name&fields[1]=status&fields[2]=retail_cost&fields[3]=final_price&fields[4]=discount_provided&fields[5]=createdAt&fields[6]=updatedAt`;

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

    data.data.forEach(estimate => {
      const est = estimate.attributes;
      if (est.status === "Lost") {
        const config = est.branch_configuration?.data?.attributes || null;
        console.log({
          branch_id: branchId,
          id: estimate.id,
          name: est.name,
          final_price: est.final_price,
          retail_cost: est.retail_cost,
          discount_provided: est.discount_provided,
          createdAt: est.createdAt,
          updatedAt: est.updatedAt,
          status: est.status,
          branch_configuration: config
        });
      }
    });

  } catch (err) {
    console.error(`❌ Error fetching branch ${branchId}:`, err.message);
  }
}

async function main() {
  for (const id of branchIds) {
    await fetchLostEstimates(id);
  }
}

main();