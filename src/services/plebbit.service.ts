import { Plebbit } from "@plebbit/plebbit-js/dist/node/plebbit.js";
import { log } from "../index.js";

export class PlebbitService {
    plebbit: Plebbit;
    constructor() {
        this.plebbit = new Plebbit({
            ipfsHttpClientsOptions: ["http://localhost:5001/api/v0"],
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
        const signer = await this.plebbit.createSigner();
        return signer;
    }
}
