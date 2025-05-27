const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const importController = require('../controllers/importController');

// Configurar multer para la subida de archivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Solo permitir archivos Excel
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
            file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos Excel (.xlsx, .xls)'), false);
        }
    }
});

// Get branches for the dropdown
router.get('/branches', importController.getBranches);

// Render the import form with branch selection
router.get('/form', importController.renderImportForm);

// Render import form for a specific campaign
router.get('/form/:campaignId', importController.renderImportForm);

// Ruta para importar leads
router.post('/leads', upload.single('file'), importController.importLeads);

module.exports = router; 