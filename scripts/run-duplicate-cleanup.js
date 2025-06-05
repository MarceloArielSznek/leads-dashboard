/**
 * Duplicate Cleanup Runner
 * 
 * Usage:
 *   node scripts/run-duplicate-cleanup.js --dry-run          (safe preview)
 *   node scripts/run-duplicate-cleanup.js --live            (actual cleanup)
 *   node scripts/run-duplicate-cleanup.js --live --no-backup (cleanup without backup)
 */

const { cleanupDuplicates } = require('./cleanup-duplicates');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || !args.includes('--live');
const shouldBackup = !args.includes('--no-backup');

// Update configuration
const CONFIG = {
    DRY_RUN: isDryRun,
    BACKUP_BEFORE_DELETE: shouldBackup,
    LOG_LEVEL: 'detailed'
};

console.log('🧹 DUPLICATE CLEANUP RUNNER');
console.log('============================');
console.log(`Mode: ${CONFIG.DRY_RUN ? '🔍 DRY RUN' : '🚨 LIVE MODE'}`);
console.log(`Backup: ${CONFIG.BACKUP_BEFORE_DELETE ? '✅' : '❌'}`);

if (CONFIG.DRY_RUN) {
    console.log('\n⚠️  This is a SAFE preview mode - no data will be deleted');
    console.log('💡 To perform actual cleanup, use: node scripts/run-duplicate-cleanup.js --live');
} else {
    console.log('\n🚨 WARNING: This will DELETE duplicate records from your database!');
    console.log('💾 Make sure you have a backup before proceeding.');
    
    // Give user 5 seconds to cancel
    console.log('\n⏱️  Starting in 5 seconds... Press Ctrl+C to cancel');
    setTimeout(() => {
        console.log('🚀 Starting cleanup...\n');
        runCleanup();
    }, 5000);
    return;
}

function runCleanup() {
    // Override the config in the cleanup module
    require('./cleanup-duplicates');
    cleanupDuplicates()
        .then(() => {
            console.log('\n✅ Cleanup completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Cleanup failed:', error);
            process.exit(1);
        });
}

// For dry-run, start immediately
if (CONFIG.DRY_RUN) {
    runCleanup();
} 