import { log, plebbit } from "../index.js";

export class PlebbitService {
    async loadSigner(privateKey: string) {
        try {
            const signerFromPrivateKey = await plebbit.createSigner({
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
            const signer = await plebbit.createSigner();
            return signer;
        } catch (e) {
            log.error(e);
            return null;
        }
    }
}
