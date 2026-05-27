const https = require('https');
const zlib = require('zlib');
const fs = require('fs');

const url = "https://storage.googleapis.com/eas-workflows-production/logs/359d678e-04cf-4780-82cf-f9392c2a3d45/fd0716f1-eae7-4d50-88ee-2837310a9f79/2026-05-27T12%3A47%3A17Z-dd5ac952-2b9d-4f9c-9305-88427b66913e.txt?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=www-production%40exponentjs.iam.gserviceaccount.com%2F20260527%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20260527T130008Z&X-Goog-Expires=900&X-Goog-SignedHeaders=host&X-Goog-Signature=b04d1f2e1f6e2dd39dfd43b9c7b9492f254e0b02f8f74e64fca1859c5d082fa2f567b4b1a43a6d713c7bb62939e6a88b50b5ec1e21b8fbfad3d9f3f4581f14841d13f02ce855f9a65f9cd74ccf0e21a28a2a890479155ad3f619e0ee254b0ebfcd5e523f6cb4a4b276ff11ff3c43141f2a00c6d7d6f51950e3ce9e31d4ffbc06078ad30953a79d3000b0c6dfecfa4c8524dd97ff8b0ebc3bc8be263b6b696f8c7eb462dfd1cc1bc49354fc5815cf1b43ca0de0cebc8cc274299b80ca8c4c7af6d7732a3fc4c9ebcb8025287f3747b0680af36af4fa430bdfdb30e7c53e0f9b6fe18ea0283ca2316e6d5e5e2e8587d60fc040a6b5a3eb87a950ca0e58c9b3d1796fe3";

https.get(url, (res) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const buffer = Buffer.concat(chunks);
    console.log('Received bytes:', buffer.length);
    console.log('Raw text preview:', buffer.toString('utf8').slice(0, 500));
    zlib.brotliDecompress(buffer, (err, decoded) => {
      if (err) {
        console.error('Brotli decompression failed:', err);
        return;
      }
      fs.writeFileSync('logs_decoded.txt', decoded);
      console.log('Decoded content saved to logs_decoded.txt, length:', decoded.length);
    });
  });
}).on('error', (err) => {
  console.error('Fetch failed:', err);
});
