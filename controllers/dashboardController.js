const mailchimp = require('@mailchimp/mailchimp_marketing');
const crypto = require('crypto');
mailchimp.setConfig({
  apiKey: '4bcfff3b9e1ff54968adf9f64a62dfc9-us10',
  server: 'us10',
});

exports.exportToMailchimp = async (req, res) => {
  const { contacts, tags } = req.body; // [{email, first_name, last_name}], tags: array de strings
  const listId = '87ce9061d9';
  
  // Log de los datos recibidos
  console.log('=== Datos recibidos para exportar a Mailchimp ===');
  console.log('Tags seleccionados:', tags);
  console.log('Contactos a exportar:', JSON.stringify(contacts, null, 2));
  console.log('===============================================');
  
  try {
    const results = [];
    for (const contact of contacts) {
      try {
        console.log('\nProcessing contact:', contact.email);
        // 1. Calcular el hash del email
        const emailHash = crypto.createHash('md5').update(contact.email.toLowerCase()).digest('hex');
        // 2. Obtener los tags actuales del contacto
        let currentTags = [];
        try {
          const tagRes = await mailchimp.lists.getListMemberTags(listId, emailHash);
          currentTags = (tagRes.tags || []).map(t => t.name);
        } catch (err) {
          // Si el contacto no existe, ignorar el error
          if (err.status !== 404) throw err;
        }
        // 3. Eliminar todos los tags actuales si existen
        if (currentTags.length > 0) {
          const tagsToRemove = currentTags.map(name => ({ name, status: 'inactive' }));
          await mailchimp.lists.updateListMemberTags(listId, emailHash, { tags: tagsToRemove });
        }
        // 4. Agregar el contacto y los nuevos tags
        const memberData = {
          email_address: contact.email,
          status: 'subscribed',
          merge_fields: {},
          tags: tags || []
        };
        // Agregar todos los campos mapeados a merge_fields
        Object.entries(contact).forEach(([key, value]) => {
          if (key !== 'email' && key !== 'tags') {
            memberData.merge_fields[key] = value;
          }
        });
        console.log('Member data to be sent:', JSON.stringify(memberData, null, 2));
        const response = await mailchimp.lists.addListMember(listId, memberData);
        console.log('Mailchimp API Response:', JSON.stringify(response, null, 2));
        results.push({ email: contact.email, status: 'success' });
      } catch (err) {
        console.error('Error exporting contact:', contact.email);
        console.error('Error details:', err.message);
        console.error('Full error:', err);
        results.push({ email: contact.email, status: 'error', error: err.message });
      }
    }
    
    console.log('\nExport Summary:');
    console.log('Success:', results.filter(r => r.status === 'success').length);
    console.log('Errors:', results.filter(r => r.status === 'error').length);
    console.log('=== End Mailchimp Export Debug ===\n');
    
    res.json({ results });
  } catch (error) {
    console.error('Fatal error in exportToMailchimp:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getMailchimpTags = async (req, res) => {
  const listId = '87ce9061d9';
  try {
    let allSegments = [];
    let offset = 0;
    const limit = 100; // Máximo permitido por Mailchimp
    
    while (true) {
      const response = await mailchimp.lists.listSegments(listId, {
        type: 'static',
        count: limit,
        offset: offset
      });
      
      const segments = response.segments
        .filter(seg => seg.name.toLowerCase().includes('marcelo'))
        .map(seg => ({
          id: seg.id,
          name: seg.name
        }));
      
      allSegments = [...allSegments, ...segments];
      
      // Si recibimos menos segmentos que el límite, significa que ya no hay más
      if (response.segments.length < limit) {
        break;
      }
      
      offset += limit;
    }
    
    res.json(allSegments);
  } catch (error) {
    console.error('Error getting Mailchimp tags:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getMailchimpListFields = async (req, res) => {
  const listId = '87ce9061d9';
  try {
    const response = await mailchimp.lists.getListMergeFields(listId);
    const fields = [
      {
        tag: 'EMAIL',
        name: 'Email Address',
        type: 'email',
        required: true
      },
      ...response.merge_fields.map(field => ({
        tag: field.tag,
        name: field.name,
        type: field.type,
        required: field.required
      }))
    ];
    res.json(fields);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}; 