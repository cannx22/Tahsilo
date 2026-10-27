import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Her test dosyası uygulama modülleri yüklenmeden önce test veritabanına yönlendirilir.
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.WORKER_DISABLED = '1';
process.env.STORAGE_DIR = path.resolve(__dirname, '../storage-test');
