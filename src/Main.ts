import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt64,
  UInt32,
  AccountUpdate,
  Bool,
  PublicKey,
  Reducer,
  Poseidon,
  Permissions,
} from 'snarkyjs';
import { RewardToken } from './RewardToken';
/**
 *
 */
export class Main extends SmartContract {
  @state(Field) num = State<Field>();
  @state(UInt32) blockHeight = State<UInt32>();
  @state(PublicKey) deployer = State<PublicKey>();
  @state(PublicKey) rewardTokenAddr = State<PublicKey>();

  // on-chain version of our state. it will typically lag behind the
  // version that's implicitly represented by the list of actions
  @state(Field) counter = State<Field>();
  // helper field to store the point in the action history that our on-chain state is at
  @state(Field) actionsHash = State<Field>();
  secret = Field(1111);
  reducer = Reducer({ actionType: Field });
  events = {
    updatedNum: Field,
    deployedBy: PublicKey,
  };
  /**
   * This method initializes the contract and it's state
   */
  init() {
    super.init();
    this.account.provedState.assertEquals(Bool(false));
    this.num.set(Field(1));
    const timestamp = this.network.timestamp.get();
    this.network.timestamp.assertEquals(timestamp);

    const blockHeight = this.network.blockchainLength.get();
    this.network.blockchainLength.assertEquals(blockHeight);
    this.blockHeight.set(blockHeight);
    this.deployer.set(this.sender);

    this.counter.set(Field(0));
    this.actionsHash.set(Reducer.initialActionsHash);

    this.emitEvent('deployedBy', this.sender);
  }
  /**
   * This method is used to test setting the permissions using proof
   */
  @method setPermissionWithProof() {
    this.account.permissions.set({
      ...Permissions.default(),
      setDelegate: Permissions.proof(),
    });
  }
  /**
   * This method is used to test setting the delegation using proof
   */
  @method setDelegateWithProof(delegateTo: PublicKey) {
    this.account.delegate.set(delegateTo);
  }
  /**
   * This method is used to set reward token
   * which is a seprate smart contract that can be called within Main
   */
  @method setRewardToken(rewardTokenAddress: PublicKey) {
    const admin = this.deployer.get();
    this.deployer.assertEquals(admin);
    admin.assertEquals(this.sender);
    this.rewardTokenAddr.set(rewardTokenAddress);
  }
  /**
   * This method is used to mint tokens under contract Main
   * and to mint Reward Tokens on a seperate smart contract
   */
  @method mintNewTokens(receiverAddress: PublicKey) {
    // only if balance of this zkApp is above x
    const amount = UInt64.from(10000);
    const rewardTokenAddr = this.rewardTokenAddr.get();
    this.rewardTokenAddr.assertEquals(rewardTokenAddr);
    const zkReward = new RewardToken(rewardTokenAddr);
    const secretHash = Poseidon.hash([this.secret]);
    this.token.mint({
      address: receiverAddress,
      amount: amount,
    });
    zkReward.mintNewTokens(secretHash, amount.div(100));
  }

  @method burnTokens(addressToDecrease: PublicKey, amount: UInt64) {
    this.token.burn({
      address: addressToDecrease,
      amount,
    });
  }

  @method sendTokens(receiverAddress: PublicKey, amount: UInt64) {
    this.token.send({
      to: receiverAddress,
      from: this.sender,
      amount,
    });
  }
  /**
   * This method increments num state by 2 and
   * checks that the caller delegetes to himself and
   * have balance above 3 Mina
   */
  @method veteranUpdate() {
    let userAccUpdate = AccountUpdate.create(this.sender);
    userAccUpdate.account.delegate.assertEquals(this.sender);
    userAccUpdate.account.balance.assertBetween(
      UInt64.from(3000000000),
      UInt64.MAXINT()
    );
    const currentState = this.num.get();
    this.num.assertEquals(currentState); // precondition that links this.num.get() to the actual on-chain state
    const newState = currentState.add(2);
    this.num.set(newState);
    this.emitEvent('updatedNum', newState);
  }
  /**
   * This method increments num state by 1 and
   * checks that the caller delegetes to another address
   */
  @method regularUpdate() {
    let userAccUpdate = AccountUpdate.create(this.sender);
    let delegationAddr = userAccUpdate.account.delegate.get();
    userAccUpdate.account.delegate.assertEquals(delegationAddr);
    let isDelegeted = delegationAddr.equals(this.sender);
    isDelegeted.assertFalse();

    const currentState = this.num.get();
    this.num.assertEquals(currentState);
    const newState = currentState.add(1);
    this.num.set(newState);
    this.emitEvent('updatedNum', newState);
  }

  /**
   * This method sends half of the Mina tokens
   * hold on this smart contract to receiver who's acccount is new
   */
  @method newPayout(receiver: PublicKey) {
    //check if the receiver account is new
    let userAccUpdate = AccountUpdate.create(receiver);
    userAccUpdate.account.isNew.assertEquals(Bool(true));

    let balance = this.account.balance.get();
    this.account.balance.assertEquals(balance);
    let halfBalance = balance.div(2);
    this.send({ to: userAccUpdate, amount: halfBalance });
  }

  /**
   * This method is dispatching the action of incrementing reducer by Field(1)
   */
  @method incrementCounter() {
    this.reducer.dispatch(Field(1));
  }
  /**
   * This method is dispatching the action of incrementing reducer by Field(2)
   */
  @method incrementCounterBy2() {
    this.reducer.dispatch(Field(2));
  }
  /**
   * This method rolls up the above increments and
   * updates the state within the smart contract
   */
  @method rollupIncrements() {
    // get previous counter & actions hash, assert that they're the same as on-chain values
    let counter = this.counter.get();
    this.counter.assertEquals(counter);
    let actionsHash = this.actionsHash.get();
    this.actionsHash.assertEquals(actionsHash);
    // compute the new counter and hash from pending actions
    let pendingActions = this.reducer.getActions({
      fromActionState: actionsHash,
    });
    // Circuit.log('pendingActions', pendingActions);
    let { state: newCounter, actionsHash: newActionsHash } =
      this.reducer.reduce(
        pendingActions,
        // state type
        Field,
        // function that says how to apply an action
        (state: Field, _action: Field) => {
          // Circuit.log(_action);
          return state.add(_action);
        },
        { state: counter, actionsHash }
      );
    // update on-chain state
    this.counter.set(newCounter);
    this.actionsHash.set(newActionsHash);
  }
}
