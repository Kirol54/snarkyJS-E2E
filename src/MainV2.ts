import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  Bool,
  PublicKey,
  Reducer,
  Circuit,
  Permissions,
} from 'snarkyjs';
/**
 * MainV2 smart contract is an upgrade of the Main contract. It has to retain same state
 * structure and declarations in order to be able to leverage on already set state
 *
 * It tests mainly the actions and permissions enforcement
 */
export class MainV2 extends SmartContract {
  @state(Field) num = State<Field>();
  @state(UInt32) blockHeight = State<UInt32>();
  @state(PublicKey) deployer = State<PublicKey>();
  @state(PublicKey) rewardTokenAddr = State<PublicKey>();
  @state(Field) counter = State<Field>();
  @state(Field) actionsHash = State<Field>();
  reducer = Reducer({ actionType: Bool });

  @method lockAccessPermissions() {
    this.account.permissions.set({
      ...Permissions.default(),
      setDelegate: Permissions.proof(),
      setVerificationKey: Permissions.impossible(),
      setPermissions: Permissions.proofOrSignature(),
      access: Permissions.impossible(),
    });
  }
  /**
   * This method is used to test setting the delegation using proof
   */
  @method setDelegateWithProof(delegateTo: PublicKey) {
    this.account.delegate.set(delegateTo);
  }
  /**
   * This method is dispatching the action of Bool(true) to the reducer
   */
  @method incrementCounter() {
    this.reducer.dispatch(Bool(true));
  }
  /**
   * This method is dispatching the action of Bool(false) to the reducer
   */
  @method decreaseCounter() {
    this.reducer.dispatch(Bool(false));
  }
  /**
   * This method rolls up the above actions and
   * based on the branching logic either increments or decrements the counter and
   * updates the state within the smart contract
   */
  @method rollupCounter() {
    let counter = this.counter.get();
    this.counter.assertEquals(counter);
    let actionsHash = this.actionsHash.get();
    this.actionsHash.assertEquals(actionsHash);
    let pendingActions = this.reducer.getActions({
      fromActionState: actionsHash,
    });
    // Circuit.log('pendingActions', pendingActions);
    let { state: newCounter, actionsHash: newActionsHash } =
      this.reducer.reduce(
        pendingActions,
        Field,
        (state: Field, _action: Bool) => {
          // Circuit.log(_action);
          return Circuit.if(
            _action,
            state.add(1),
            Circuit.if(state.equals(Field(0)), state, state.sub(1))
          );
        },
        { state: counter, actionsHash }
      );
    // update on-chain state
    this.counter.set(newCounter);
    this.actionsHash.set(newActionsHash);
  }
}
