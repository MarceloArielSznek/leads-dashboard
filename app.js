require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', require('path').join(__dirname, 'views'));

// Routes
const campaignRoutes = require('./routes/campaignRoutes');
const leadRoutes = require('./routes/leadRoutes');
const adminRoutes = require('./routes/adminRoutes');
const importRoutes = require('./routes/importRoutes');
const insightRoutes = require('./routes/insightRoutes');

app.use('/campaign', campaignRoutes);
app.use('/lead', leadRoutes);
app.use('/admin', adminRoutes);
app.use('/import', importRoutes);
app.use('/insights', insightRoutes);

// Crear directorio de uploads si no existe
const fs = require('fs');
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Home route
app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

// Dashboard route
app.get('/dashboard', (req, res) => {
    res.render('dashboard');
});

// Admin panel route
app.get('/admin-panel', (req, res) => {
    res.render('admin');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { error: err });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
}); 