const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Get all leads for a campaign
router.get('/campaign/:campaignId', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM leads_dashboard.lead WHERE campaign_id = $1 ORDER BY created_at DESC',
            [req.params.campaignId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single lead
router.get('/:id', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM leads_dashboard.lead WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update lead status (patch)
router.patch('/:id/status', async (req, res) => {
    const { status_id } = req.body;
    try {
        const result = await db.query(
            'UPDATE leads_dashboard.lead SET lead_status_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [status_id, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add note to lead
router.post('/:id/notes', async (req, res) => {
    const { note } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO lead_notes (lead_id, note) VALUES ($1, $2) RETURNING *',
            [req.params.id, note]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get lead notes
router.get('/:id/notes', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM lead_notes WHERE lead_id = $1 ORDER BY created_at DESC',
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router; 