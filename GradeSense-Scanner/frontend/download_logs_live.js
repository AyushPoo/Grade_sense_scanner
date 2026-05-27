const { exec } = require('child_process');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');

console.log('Fetching build details from EAS...');
exec('eas build:view fd0716f1-eae7-4d50-88ee-2837310a9f79 --json', (err, stdout, stderr) => {
  if (err) {
    console.error('Failed to run eas build:view:', err);
    return;
  }
  
  // Find JSON start
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) {
    console.error('No JSON found in output:', stdout);
    return;
  }
  
  const jsonStr = stdout.slice(jsonStart);
  try {
    const buildData = JSON.parse(jsonStr);
    if (!buildData.logFiles || buildData.logFiles.length === 0) {
      console.log('No log files available yet. Build status:', buildData.status);
      return;
    }
    
    const url = buildData.logFiles[0];
    console.log('Fetching logs from URL...');
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log('Received bytes:', buffer.length);
        if (buffer.length < 2000 && buffer.toString().includes('<?xml')) {
          console.error('Google Cloud Storage error response:', buffer.toString('utf8'));
          return;
        }
        
        zlib.brotliDecompress(buffer, (decompErr, decoded) => {
          if (decompErr) {
            console.error('Brotli decompression failed:', decompErr);
            return;
          }
          fs.writeFileSync('logs_decoded.txt', decoded);
          console.log('Successfully decompressed logs, saved to logs_decoded.txt, length:', decoded.length);
          
          // Print the last 20 lines
          const lines = decoded.toString('utf8').split('\n');
          console.log('\n--- LAST 20 LINES OF LOGS ---');
          console.log(lines.slice(-20).join('\n'));
        });
      });
    }).on('error', (fetchErr) => {
      console.error('Failed to fetch logs:', fetchErr);
    });
  } catch (parseErr) {
    console.error('Failed to parse JSON:', parseErr, jsonStr);
  }
});
