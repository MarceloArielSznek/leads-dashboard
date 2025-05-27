const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const campaignController = require('../controllers/campaignController');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-campaign-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Only allow Excel files
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
            file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
        }
    }
});

// Campaign routes
router.get('/', campaignController.getAllCampaigns);
router.get('/types', campaignController.getCampaignTypes);
router.get('/branches', campaignController.getBranches);
router.get('/:id', campaignController.getCampaignById);
router.post('/', campaignController.createCampaign);
router.delete('/:id', campaignController.deleteCampaign);
router.get('/:id/export', campaignController.exportCampaign);
router.post('/:id/upload', upload.single('file'), campaignController.uploadLeads);
// (Opcional: agregar updateCampaign y deleteCampaign si los implementas en el controlador)

// Lead routes
router.get('/:id/leads', campaignController.getCampaignLeads);
router.get('/lead/:id', campaignController.getLeadById);
router.put('/lead/:id', campaignController.updateLead);
router.delete('/lead/:id', campaignController.deleteLead);

module.exports = router; 