import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import * as fs from 'fs';

const fsConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(fsConfig);
const db = getFirestore(app);

async function run() {
  try {
    const docRef = doc(db, 'stores', 'jcetHeowbgDh7KQfumWV');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      console.log('REAL_STORE_FIELDS_JSON_START');
      console.log(JSON.stringify(docSnap.data(), null, 2));
      console.log('REAL_STORE_FIELDS_JSON_END');
    } else {
      console.log('REAL_STORE_FIELDS_JSON_START');
      console.log('NOT_FOUND');
      console.log('REAL_STORE_FIELDS_JSON_END');
    }
  } catch (error) {
    console.error('ERROR:', error);
  }
  process.exit(0);
}

run();
