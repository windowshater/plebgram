import { Plebbit } from "@plebbit/plebbit-js/dist/node/plebbit.js";
import { log } from "../index.js";
import { Signer } from "@plebbit/plebbit-js/dist/node/signer/index.js";

export class PlebbitService {
    plebbit: Plebbit;

    constructor() {
        this.plebbit = new Plebbit({
            ipfsHttpClientsOptions: [
                "http://localhost:5001/api/v0",
                "https://pubsubprovider.xyz/api/v0",
            ],
        });
        this.plebbit.on("error", (err) => {
            log.error(err);
        });
    }
    async loadSigner(privateKey: string) {
        try {
            const signerFromPrivateKey = await this.plebbit.createSigner({
                privateKey: privateKey,
                type: "ed25519",
            });
            return signerFromPrivateKey;
        } catch (e) {
            log.error(e);
            return null;
        }
    }
    async createSigner() {
        try {
            const signer = await this.plebbit.createSigner();
            return signer;
        } catch (e) {
            log.error(e);
            return null;
        }
    }
    
}
