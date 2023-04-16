import { Field, SmartContract, method, UInt64, Poseidon } from 'snarkyjs';
import { RecursionProgramProof } from './RecursionProgram';
export class RewardToken extends SmartContract {
  secret = Field(1111);
  /*
   * This method is used on transfers of Main tokens to mint
   * rewards tokens of this smart contract
   */
  @method mintNewTokens(secretHash: Field, amount: UInt64) {
    secretHash.assertEquals(Poseidon.hash([this.secret]));
    this.token.mint({
      address: this.sender,
      amount,
    });
  }

  @method rewardRecursiveProof(proof: RecursionProgramProof) {
    proof.verify();
    proof.publicInput.publicKey.assertEquals(this.sender);
    proof.publicInput.signature.verify(this.sender, [this.secret]).assertTrue();
    this.token.mint({
      address: this.sender,
      amount: 88888888,
    });
  }
}
