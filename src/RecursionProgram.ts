import {
  Field,
  UInt64,
  PrivateKey,
  PublicKey,
  Experimental,
  SelfProof,
  Signature,
  Struct,
} from 'snarkyjs';
import ZkProgram = Experimental.ZkProgram;

export class ProgramInput extends Struct({
  signature: Signature,
  publicKey: PublicKey,
  valueToMultiply: UInt64,
}) {}

/**
 * This ZKProgram is used to test the recursion feature of snarkyjs,
 *
 */
export const RecursionProgram = ZkProgram({
  publicInput: ProgramInput,

  methods: {
    /**
     * This method creates proof that user has the private key for address from public input
     */
    verifyKey: {
      privateInputs: [PrivateKey],

      method(publicInput: ProgramInput, privKey: PrivateKey) {
        privKey.toPublicKey().assertEquals(publicInput.publicKey);
      },
    },
    /**
     * This method creates proof that the user has signed the secret with the private key
     *  and run the computation on valueToMultiply
     */
    verifySig: {
      privateInputs: [PrivateKey, Field, SelfProof],

      method(
        publicInput: ProgramInput,
        privKey: PrivateKey,
        secret: Field,
        earlierProof: SelfProof<ProgramInput>
      ) {
        publicInput.signature
          .verify(privKey.toPublicKey(), [secret])
          .assertTrue();
        publicInput.valueToMultiply.assertEquals(
          earlierProof.publicInput.valueToMultiply.mul(8)
        );
      },
    },
    /**
     * This method creates one single proof from two proofs
     * and verifes that user had run the computation on valueToMultiply
     */
    mergeProofs: {
      privateInputs: [SelfProof, SelfProof],

      method(
        newState: ProgramInput,
        verifyKeyProof: SelfProof<ProgramInput>,
        verifySigProof: SelfProof<ProgramInput>
      ) {
        verifyKeyProof.verify();
        verifySigProof.verify();
        newState.valueToMultiply.assertEquals(
          verifyKeyProof.publicInput.valueToMultiply.mul(
            verifySigProof.publicInput.valueToMultiply
          )
        );
      },
    },
  },
});
export class RecursionProgramProof extends Experimental.ZkProgram.Proof(
  RecursionProgram
) {}
