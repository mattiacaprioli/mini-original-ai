import {MongoClient} from "mongodb";

// directConnection=true è richiesto dall'immagine Atlas locale (replica set a un solo nodo).
const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/?directConnection=true";

// Il client si connette da solo alla prima operazione e mantiene un pool di connessioni:
// se ne crea UNO per processo, non uno per richiesta.
export const mongo = new MongoClient(uri);
export const db = mongo.db(process.env.MONGODB_DB ?? "mini_original_ai");