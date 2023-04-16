import {
  isReady,
  shutdown,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  UInt32,
  UInt64,
  Bool,
  Reducer,
  fetchAccount,
  Poseidon,
  Signature,
  Permissions,
  Proof,
} from 'snarkyjs';
import { Main, MainV2, RewardToken, RecursionProgram, ProgramInput } from '.';
import { getCtx, waitForNextBlock } from './setup';
await isReady;
let secret = 1111;
const testOnBerkeley = process.env.TEST_ON_BERKELEY;

describe('Full contract tests', () => {
  async function runTests(deployToBerkeley = false) {
    if (testOnBerkeley == 'true') deployToBerkeley = true;
    async function fetchAccounts(accAddr: PublicKey[]) {
      if (deployToBerkeley) {
        await Promise.all(
          accAddr.map((addr) => fetchAccount({ publicKey: addr }))
        );
      }
    }
    async function waitUntilNextBlock() {
      if (deployToBerkeley) await waitForNextBlock();
    }
    let senderKey: PrivateKey,
      sender: PublicKey,
      zkappAddress: PublicKey,
      zkAppPrivateKey: PrivateKey,
      zkapp: Main,
      zkappV2: MainV2,
      latestNum: Field,
      latestCounter: Field,
      zkReward: RewardToken,
      rewardPublic: PublicKey,
      testingAccounts: any,
      transactionFee: number,
      rewardTokenVerificationKey: any,
      proofsEnabled: boolean;
    beforeAll(async () => {
      await isReady;
      const deployContext = await getCtx(deployToBerkeley);
      ({
        sender,
        senderKey,
        rewardPublic,
        zkapp,
        zkappAddress,
        zkAppPrivateKey,
        zkReward,
        testingAccounts,
        transactionFee,
        rewardTokenVerificationKey,
        proofsEnabled,
      } = deployContext);
    }, 2200000);
    afterAll(() => {
      setInterval(shutdown, 0);
    });
    it('#0.1 verifies deployment of the zkapps', async () => {
      console.log('starting tests');
      await fetchAccounts([zkappAddress]);
      const num = zkapp.num.get();
      const blockHeight = zkapp.blockHeight.get();
      const counter = zkapp.counter.get();
      const actionsHash = zkapp.actionsHash.get();
      const deployer = zkapp.deployer.get();
      expect(num).toEqual(Field(1));
      latestNum = num!;
      expect(counter).toEqual(Field(0));
      expect(deployer).toEqual(sender);
      expect(actionsHash).toEqual(Reducer.initialActionsHash);
      // fetches all events
      let events = await zkapp.fetchEvents();
      deployToBerkeley
        ? expect(blockHeight.add(1)).toEqual(events[0].blockHeight)
        : expect(blockHeight).toEqual(events[0].blockHeight);
      expect(deployer).toEqual(events[0].event.data);
    });
    itLocal('#0.2 fails when init is called again', async () => {
      let tx = await Mina.transaction(
        { sender: sender, fee: transactionFee },
        () => {
          zkapp.init();
        }
      );
      await tx.prove();
      tx.sign([senderKey]);
      await expect(tx.send()).rejects.toThrow(
        proofsEnabled
          ? /the required authorization was not provided or is invalid/
          : /Update_not_permitted_app_state/
      );
    });

    describe('#1 check default permission', () => {
      it('verifies correct default permission', async () => {
        console.log('start #1');
        let defaultPermissions = {
          ...Permissions.default(),
        };
        let zkAppAccount = deployToBerkeley
          ? (await fetchAccount({ publicKey: zkappAddress })).account
          : Mina.getAccount(zkappAddress);
        expect(zkAppAccount?.permissions).toEqual(defaultPermissions);
      });
      it('succeeds setting signature-gated values', async () => {
        let tokenSymbol = 'ABC';
        let zkappUri = 'http://meta.data.com/json123';
        let timingSchedule = {
          initialMinimumBalance: UInt64.zero,
          cliffAmount: UInt64.from(2),
          cliffTime: UInt32.one,
          vestingIncrement: UInt64.zero,
          vestingPeriod: UInt32.one,
        };
        let votingFor = Poseidon.hash([Field(1337)]);
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          AccountUpdate.attachToTransaction(zkapp.self);
          zkapp.account.delegate.set(sender);
          zkapp.account.tokenSymbol.set(tokenSymbol);
          zkapp.account.zkappUri.set(zkappUri);
          zkapp.account.timing.set(timingSchedule);
          zkapp.account.votingFor.set(votingFor);
          zkapp.requireSignature();
        });
        tx.sign([senderKey, zkAppPrivateKey]);
        await (await tx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();
        let zkAppAccount = deployToBerkeley
          ? (await fetchAccount({ publicKey: zkappAddress })).account
          : Mina.getAccount(zkappAddress);
        expect(zkAppAccount?.delegate).toEqual(sender);
        expect(zkAppAccount?.tokenSymbol).toEqual(tokenSymbol);
        expect(zkAppAccount?.zkapp?.zkappUri).toEqual(zkappUri);
        console.log(
          'is timing true?: ',
          zkAppAccount?.timing == timingSchedule
        );
        // expect(zkAppAccount?.timing).toEqual(timingSchedule); //Doesn't work on berkeley
        console.log(
          'voting for: ',
          zkAppAccount?.votingFor.toBigInt().toString()
        );
        if (!deployToBerkeley)
          expect(zkAppAccount?.votingFor).toEqual(votingFor); // Berkelely returns 0 bug ?
      });
      itLocal('fails to set signature-gated values', async () => {
        //setPermissions: signature // using proof
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          zkapp.setPermissionWithProof();
        });
        tx.sign([senderKey]);
        await tx.prove();
        await expect(tx.send()).rejects.toThrow(
          /the required authorization was not provided or is invalid/
        );
        //setDelegate: signature // using proof
        tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          zkapp.setDelegateWithProof(PrivateKey.random().toPublicKey());
        });
        tx.sign([senderKey]);
        await tx.prove();
        await expect(tx.send()).rejects.toThrow(
          /the required authorization was not provided or is invalid/
        );
        //setZkappUri: signature
        tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          AccountUpdate.attachToTransaction(zkapp.self);
          zkapp.account.zkappUri.set('horror');
        });
        tx.sign([senderKey]);
        await tx.prove();
        await expect(tx.send()).rejects.toThrow(
          /the required authorization was not provided or is invalid/
        );
        //setTokenSymbol: signature
        tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          AccountUpdate.attachToTransaction(zkapp.self);
          zkapp.account.tokenSymbol.set('horror');
        });
        tx.sign([senderKey]);
        await tx.prove();
        await expect(tx.send()).rejects.toThrow(
          /the required authorization was not provided or is invalid/
        );
      });
      itLocal(
        'fails to set proof-gated values with signature only',
        async () => {
          //editState: proof
          await fetchAccounts([sender, zkappAddress]);
          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              AccountUpdate.attachToTransaction(zkapp.self);
              zkapp.counter.set(Field(666));
              zkapp.requireSignature();
            }
          );
          tx.sign([senderKey, zkAppPrivateKey]);
          await expect(tx.send()).rejects.toThrow(
            proofsEnabled
              ? /the required authorization was not provided or is invalid/
              : /Update_not_permitted_app_state/
          );

          await fetchAccounts([sender, zkappAddress]);
          //editActionsState: proof
          tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
            AccountUpdate.attachToTransaction(zkapp.self);
            zkapp.reducer.dispatch(Field(666));
            zkapp.requireSignature();
          });

          tx.sign([senderKey, zkAppPrivateKey]);

          await tx.prove();
          await expect(tx.send()).rejects.toThrow(
            proofsEnabled
              ? /the required authorization was not provided or is invalid/
              : /Update_not_permitted_action_state/
          );
        }
      );
    });
    describe('#2 veteranUpdate method', () => {
      it(`succeeds veteranUpdate method call `, async () => {
        console.log('start #2');
        await fetchAccounts([zkappAddress, sender]);
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          zkapp.veteranUpdate();
        });
        tx.sign([senderKey]);
        await tx.prove();
        await (await tx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();
        await fetchAccounts([zkappAddress]);
        const num = zkapp.num.get();
        expect(num).toEqual(latestNum.add(2));
        latestNum = num;
      });
      itLocal(
        `fails veteranUpdate method if sender delegates to another address `,
        async () => {
          const randomKey = PrivateKey.random();
          const randomAddr = randomKey.toPublicKey();
          await fetchAccounts([zkappAddress, sender]);
          let delegateTx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              let accUpdate = AccountUpdate.create(sender);
              accUpdate.account.delegate.set(randomAddr);
              accUpdate.requireSignature();
            }
          );
          await delegateTx.prove();
          delegateTx.sign([senderKey]);
          await (await delegateTx.send()).wait({ maxAttempts: 50 });

          await waitUntilNextBlock();
          let delegationWorked = deployToBerkeley
            ? (
                await fetchAccount({ publicKey: sender })
              ).account?.delegate?.equals(randomAddr)
            : Mina.getAccount(sender).delegate?.equals(randomAddr);

          expect(delegationWorked).toEqual(Bool(true));

          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              zkapp.veteranUpdate();
            }
          );
          await tx.prove();
          tx.sign([senderKey]);
          await expect(tx.send()).rejects.toThrow(
            /Account_delegate_precondition_unsatisfied/
          );
          await fetchAccounts([zkappAddress]);
          const num = zkapp.num.get();
          expect(num).toEqual(latestNum);
        }
      );
      itLocal(
        `fails veteranUpdate method if sender have below 3 Mina `,
        async () => {
          let amount = UInt64.from(2000000000);
          const randomKey = PrivateKey.random();
          const randomAddr = randomKey.toPublicKey();
          await fetchAccounts([zkappAddress, sender]);
          let transferTx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              AccountUpdate.fundNewAccount(sender);
              let accUpdate = AccountUpdate.createSigned(sender);
              accUpdate.send({ to: randomAddr, amount });
            }
          );
          await transferTx.prove();
          await (
            await transferTx.sign([senderKey]).send()
          ).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();

          let randomAddrBalance = deployToBerkeley
            ? (await fetchAccount({ publicKey: randomAddr })).account?.balance
            : Mina.getAccount(randomAddr).balance;

          expect(randomAddrBalance).toEqual(amount);

          let tx = await Mina.transaction(
            { sender: randomAddr, fee: transactionFee },
            () => {
              zkapp.veteranUpdate();
            }
          );
          await tx.prove();
          tx.sign([randomKey]);
          await expect(tx.send()).rejects.toThrow(
            /Account_balance_precondition_unsatisfied/
          );
          const num = deployToBerkeley
            ? await zkapp.num.fetch()
            : zkapp.num.get();
          expect(num).toEqual(latestNum);
        }
      );
    });
    describe('#3 newPayout method', () => {
      it(
        `succeeds newPayout method call`,
        async () => {
          console.log('start #3');
          const amount = UInt64.from(1000000);
          const randomKey = PrivateKey.random();
          const randomAddr = randomKey.toPublicKey();
          await fetchAccounts([zkappAddress, sender]);
          const balanceBefore = zkapp.account.balance.get();
          let transferTx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              let payerAccountUpdate = AccountUpdate.createSigned(sender);
              payerAccountUpdate.send({ to: zkappAddress, amount });
            }
          );
          transferTx.sign([senderKey]);
          await transferTx.prove();
          await (await transferTx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          await fetchAccounts([zkappAddress]);
          const balanceAfter = zkapp.account.balance.get();
          expect(balanceAfter).toEqual(balanceBefore.add(amount));

          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              AccountUpdate.fundNewAccount(sender);
              zkapp.newPayout(randomAddr);
            }
          );
          tx.sign([senderKey]);
          await tx.prove();

          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();

          await fetchAccounts([zkappAddress, randomAddr]);
          let randomAccInfo = deployToBerkeley
            ? (await fetchAccount({ publicKey: randomAddr })).account?.balance
            : Mina.getAccount(randomAddr).balance;
          expect(randomAccInfo).toEqual(amount.div(2));
          expect(zkapp.account.balance.get()).toEqual(balanceAfter.div(2));
        },
        1200000 * 2 //longer timeout due to 2 blocks
      );
      itLocal(
        `fails newPayout method if receiver is not a new account`,
        async () => {
          const amount = UInt64.from(5000);
          const randomKey = PrivateKey.random();
          const randomAddr = randomKey.toPublicKey();
          await fetchAccounts([zkappAddress, sender]);
          let initialZkappBalance = zkapp.account.balance.get();
          let transferTx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              AccountUpdate.fundNewAccount(sender);
              let payerAccountUpdate = AccountUpdate.createSigned(sender);
              payerAccountUpdate.send({ to: zkappAddress, amount });
              payerAccountUpdate.send({ to: randomAddr, amount });
            }
          );
          transferTx.sign([senderKey]);
          await transferTx.prove();
          await (await transferTx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          let randrBalance = deployToBerkeley
            ? (await fetchAccount({ publicKey: randomAddr })).account?.balance
            : Mina.getAccount(randomAddr).balance;
          expect(randrBalance).toEqual(amount);
          await fetchAccounts([zkappAddress, sender]);
          expect(zkapp.account.balance.get()).toEqual(
            initialZkappBalance.add(amount)
          );

          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              AccountUpdate.fundNewAccount(sender);
              zkapp.newPayout(randomAddr);
            }
          );
          await tx.prove();
          tx.sign([senderKey]);
          await expect(tx.send()).rejects.toThrow(
            /Account_is_new_precondition_unsatisfied/
          );
          let randomAccInfo = deployToBerkeley
            ? (await fetchAccount({ publicKey: randomAddr })).account?.balance
            : Mina.getAccount(randomAddr).balance;
          expect(randomAccInfo).toEqual(amount);
          expect(zkapp.account.balance.get()).toEqual(
            initialZkappBalance.add(amount)
          );
        }
      );
    });
    describe('#4 regularUpdate method', () => {
      it(`succeeds regularUpdate method call `, async () => {
        console.log('start #4');
        await fetchAccounts([zkappAddress, sender]);
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          zkapp.regularUpdate();
        });
        tx.sign([senderKey]);
        await tx.prove();
        await (await tx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();
        await fetchAccounts([zkappAddress]);
        const num = zkapp.num.get();
        expect(num).toEqual(latestNum.add(1));
        latestNum = num;
      });
      it(`fails regularUpdate method if sender doesn't delegate to another address `, async () => {
        await fetchAccounts([sender]);
        let delegateTx = await Mina.transaction(
          { sender, fee: transactionFee },
          () => {
            let accUpdate = AccountUpdate.createSigned(sender);
            accUpdate.account.delegate.set(sender);
          }
        );
        delegateTx.sign([senderKey]);
        await (await delegateTx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();

        let delegationWorked = deployToBerkeley
          ? (
              await fetchAccount({ publicKey: sender })
            ).account?.delegate?.equals(sender)
          : Mina.getAccount(sender).delegate?.equals(sender);
        expect(delegationWorked).toEqual(Bool(true));

        let error = '';
        try {
          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              zkapp.regularUpdate();
            }
          );
          tx.sign([senderKey]);
          await tx.prove();
          await (await tx.send()).wait({ maxAttempts: 50 });
        } catch (e: any) {
          error = e.message;
        }

        expect(error).toEqual(
          'assert_equal: 0x0000000000000000000000000000000000000000000000000000000000000001 != 0x0000000000000000000000000000000000000000000000000000000000000000'
        );
        await fetchAccounts([zkappAddress]);
        const num = zkapp.num.get();
        expect(num).toEqual(latestNum);
        // console.log(events); // TODO
      });
    });
    describe('#5 token methods', () => {
      it('set reward token address', async () => {
        console.log('start #5');
        await fetchAccounts([sender, zkappAddress]);
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          zkapp.setRewardToken(rewardPublic);
        });
        tx.sign([senderKey]);
        await tx.prove();
        await (await tx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();

        await fetchAccounts([zkappAddress]);
        const tokenAddr = zkapp.rewardTokenAddr.get();
        expect(tokenAddr).toEqual(rewardPublic);
      });
      it('fails to set reward token address as not an admin', async () => {
        let tempSenderKey = deployToBerkeley
          ? PrivateKey.random()
          : testingAccounts[3].privateKey;
        let tempSender = tempSenderKey.toPublicKey();
        let error = '';
        try {
          await Mina.transaction(
            { sender: tempSender, fee: transactionFee },
            () => {
              AccountUpdate.fundNewAccount(sender);
              zkapp.setRewardToken(tempSender);
            }
          );
        } catch (e: any) {
          error = e.message;
        }
        expect(error).toContain('assert_equal:');
      });
      it('mints tokens', async () => {
        const amount = UInt64.from(10000);
        await fetchAccounts([zkappAddress, sender]);
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          AccountUpdate.fundNewAccount(sender, 2);
          zkapp.mintNewTokens(sender);
        });
        tx.sign([senderKey]);
        await tx.prove();
        await (await tx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();

        let mainTokenAccBalance = deployToBerkeley
          ? (
              await fetchAccount({
                publicKey: sender,
                tokenId: zkapp.token.id,
              })
            ).account?.balance
          : Mina.getAccount(sender, zkapp.token.id).balance;
        let rewardTokenAccBalance = deployToBerkeley
          ? (
              await fetchAccount({
                publicKey: sender,
                tokenId: zkReward.token.id,
              })
            ).account?.balance
          : Mina.getAccount(sender, zkReward.token.id).balance;
        expect(mainTokenAccBalance).toEqual(amount);
        expect(rewardTokenAccBalance).toEqual(amount.div(100));
      });
      it('succeeds to send tokens', async () => {
        let senderStartBalance = deployToBerkeley
          ? (
              await fetchAccount({
                publicKey: sender,
                tokenId: zkapp.token.id,
              })
            ).account?.balance
          : Mina.getAccount(sender, zkapp.token.id).balance;
        let tempReceiverKey = deployToBerkeley
          ? PrivateKey.random()
          : testingAccounts[4].privateKey;
        let tempReceiver = tempReceiverKey.toPublicKey();
        const amount = UInt64.from(10);
        await fetchAccounts([sender, zkappAddress]);
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          AccountUpdate.fundNewAccount(sender);
          zkapp.sendTokens(tempReceiver, amount);
        });
        tx.sign([senderKey]);
        await tx.prove();
        await (await tx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();
        let receiverBalance = deployToBerkeley
          ? (
              await fetchAccount({
                publicKey: tempReceiver,
                tokenId: zkapp.token.id,
              })
            ).account?.balance
          : Mina.getAccount(tempReceiver, zkapp.token.id).balance;
        let senderEndBalance = deployToBerkeley
          ? (
              await fetchAccount({
                publicKey: sender,
                tokenId: zkapp.token.id,
              })
            ).account?.balance
          : Mina.getAccount(sender, zkapp.token.id).balance;

        expect(receiverBalance).toEqual(amount);
        expect(senderEndBalance).toEqual(senderStartBalance!.sub(amount));
      });
      it('succeeds to burn tokens', async () => {
        const amount = UInt64.from(5);
        await fetchAccounts([zkappAddress, sender]);
        let startBalance = deployToBerkeley
          ? (
              await fetchAccount({
                publicKey: sender,
                tokenId: zkapp.token.id,
              })
            ).account?.balance
          : Mina.getAccount(sender, zkapp.token.id).balance;
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          zkapp.burnTokens(sender, amount);
        });
        tx.sign([senderKey]);
        await tx.prove();
        await (await tx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();

        let endBalance = deployToBerkeley
          ? (
              await fetchAccount({
                publicKey: sender,
                tokenId: zkapp.token.id,
              })
            ).account?.balance
          : Mina.getAccount(sender, zkapp.token.id).balance;

        expect(endBalance).toEqual(startBalance!.sub(amount));
      });
      it('fails to burn someones else tokens', async () => {
        let tempSenderKey = deployToBerkeley
          ? PrivateKey.random()
          : testingAccounts[4].privateKey;
        let tempSender = tempSenderKey.toPublicKey();
        const amount = UInt64.from(5);
        await fetchAccounts([sender, zkappAddress, tempSender]);
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          AccountUpdate.fundNewAccount(sender);
          zkapp.burnTokens(tempSender, amount);
        });
        await tx.prove();
        let error = '';
        try {
          tx.sign([senderKey]);
        } catch (e: any) {
          error = e.message;
        }
        expect(error).toContain('addMissingSignatures: Cannot add signature');
      });
    });
    describe('#6 actions testing', () => {
      let stateBefore: Field;
      let stateAfter: Field;
      it(
        'succesfully rolls up 3 increments',
        async () => {
          console.log('start #6');
          //increment x3
          await fetchAccounts([sender, zkappAddress]);
          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              zkapp.incrementCounter();
              zkapp.incrementCounter();
              zkapp.incrementCounter();
            }
          );
          tx.sign([senderKey]);
          await tx.prove();
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          await fetchAccounts([sender, zkappAddress]);
          stateBefore = zkapp.counter.get();
          expect(stateBefore).toEqual(Field(0));
          // rolling up 3x +1 increments
          tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
            zkapp.rollupIncrements();
          });
          tx.sign([senderKey]);
          await tx.prove();
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          await fetchAccounts([sender, zkappAddress]);
          stateAfter = zkapp.counter.get();
          expect(stateAfter).toEqual(stateBefore.add(3));
        },
        1200000 * 2
      );
      it(
        'succesfully rolls up 2 incrementsBy2',
        async () => {
          //incrementBy2 x2
          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              zkapp.incrementCounterBy2();
              zkapp.incrementCounterBy2();
            }
          );
          await tx.prove();
          tx.sign([senderKey]);
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          await fetchAccounts([sender, zkappAddress]);
          stateBefore = zkapp.counter.get();
          // rolling up 2x +2 increments
          tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
            zkapp.rollupIncrements();
          });
          await tx.prove();
          tx.sign([senderKey]);
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          await fetchAccounts([sender, zkappAddress]);
          stateAfter = zkapp.counter.get();
          expect(stateAfter).toEqual(stateBefore.add(2 + 2));
        },
        1200000 * 2
      );
      it(
        'succesfully rolls up 2 mixed increments',
        async () => {
          // increment + incrementBy2 = 3
          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              zkapp.incrementCounterBy2();
              zkapp.incrementCounter();
            }
          );
          await tx.prove();
          tx.sign([senderKey]);
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          await fetchAccounts([sender, zkappAddress]);
          // rolling up 1x+1 and 1x+2 increments
          tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
            zkapp.rollupIncrements();
          });
          await tx.prove();
          tx.sign([senderKey]);
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          await fetchAccounts([sender, zkappAddress]);
          let stateAfterMixed = zkapp.counter.get();
          expect(stateAfterMixed).toEqual(stateAfter.add(2 + 1));
          latestCounter = stateAfterMixed;
        },
        1200000 * 2
      );
    });
    describe('#7 upgrade the smart contract', () => {
      it(
        'updates verification key',
        async () => {
          console.log('start #7');
          //fetch acc and expect later fetch to match
          let oldVkData = deployToBerkeley
            ? (await fetchAccount({ publicKey: zkappAddress })).account?.zkapp
                ?.verificationKey?.data
            : Mina.getAccount(zkappAddress).zkapp?.verificationKey?.data;
          console.log('Compiling V2..');
          let { verificationKey } = await MainV2.compile();
          zkappV2 = new MainV2(zkappAddress);
          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              zkapp.deploy({ verificationKey });
              zkapp.account.permissions.set({
                ...Permissions.default(),
                setDelegate: Permissions.proof(),
                setVerificationKey: Permissions.impossible(),
                setPermissions: Permissions.proofOrSignature(),
              });
            }
          );
          await tx.prove();
          tx.sign([senderKey, zkAppPrivateKey]);
          console.log('sending upgrade transaction..');
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();

          expect(oldVkData).not.toEqual(
            deployToBerkeley
              ? (await fetchAccount({ publicKey: zkappAddress })).account?.zkapp
                  ?.verificationKey?.data
              : Mina.getAccount(zkapp.address).zkapp?.verificationKey?.data
          );
        },
        1200000 * 2
      );
      it('verifies correct contract deployment', async () => {
        await fetchAccounts([sender, zkappAddress]);
        let counter2 = zkappV2.counter.get();
        expect(latestCounter).toEqual(counter2);
        expect(zkappV2.deployer.get()).toEqual(sender);

        let permissions = deployToBerkeley
          ? (await fetchAccount({ publicKey: zkappAddress })).account
              ?.permissions
          : Mina.getAccount(zkapp.address).permissions;
        expect(permissions!.setDelegate).toEqual(Permissions.proof());
        expect(permissions!.setVerificationKey).toEqual(
          Permissions.impossible()
        );
        expect(permissions!.setPermissions).toEqual(
          Permissions.proofOrSignature()
        );
      });
      it('succesfully update setDelegate using proof  ', async () => {
        let randomKey = PrivateKey.random();
        let randomAddr = randomKey.toPublicKey();
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          zkappV2.setDelegateWithProof(randomAddr);
        });
        await tx.prove();
        tx.sign([senderKey]);
        await (await tx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();

        await fetchAccounts([sender, zkappAddress]);
        let delegate = zkappV2.account.delegate.get();
        expect(delegate).toEqual(randomAddr);
      });
      itLocal('fails to update verification key', async () => {
        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          zkappV2.deploy({ verificationKey: rewardTokenVerificationKey });
        });
        try {
          tx.sign([senderKey, zkAppPrivateKey]);
          await tx.prove();
          await (await tx.send()).wait({ maxAttempts: 50 });
        } catch (e: any) {
          expect(e.message).toContain("Cannot update field 'verificationKey'");
        }
      });
    });
    describe('#8 new actions testing', () => {
      let counter: Field;
      it(
        'succesfully rolls up 2 increments',
        async () => {
          console.log('start #8');
          await fetchAccounts([sender, zkappAddress]);
          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              zkappV2.incrementCounter();
              zkappV2.incrementCounter();
            }
          );
          await tx.prove();
          tx.sign([senderKey]);
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          await fetchAccounts([sender, zkappAddress]);
          //rolup the increments
          tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
            zkappV2.rollupCounter();
          });
          await tx.prove();
          tx.sign([senderKey]);
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          await fetchAccounts([sender, zkappAddress]);
          counter = zkappV2.counter.get();
          expect(counter).toEqual(latestCounter.add(2));
          latestCounter = counter;
        },
        1200000 * 2
      );
      it(
        'succesfully rolls up 2 decrements',
        async () => {
          //decreaseCounter x2
          await fetchAccounts([sender, zkappAddress]);
          let tx = await Mina.transaction(
            { sender, fee: transactionFee },
            () => {
              zkappV2.decreaseCounter();
              zkappV2.decreaseCounter();
            }
          );
          await tx.prove();
          tx.sign([senderKey]);
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();
          // rollup decrements
          tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
            zkappV2.rollupCounter();
          });
          await tx.prove();
          tx.sign([senderKey]);
          await (await tx.send()).wait({ maxAttempts: 50 });
          await waitUntilNextBlock();

          await fetchAccounts([zkappV2.address]);
          counter = zkappV2.counter.get();
          expect(counter).toEqual(latestCounter.sub(2));
          latestCounter = counter;
        },
        1200000 * 2
      );
    });
    describe('#9 Recursion ZKProgram testing', () => {
      let mergedProof: Proof<ProgramInput>;
      it('creates proofs for the methods', async () => {
        console.log('start #9');
        let realSig = Signature.create(senderKey, [Field(secret)]);
        let publicInput = new ProgramInput({
          signature: realSig,
          publicKey: sender,
          valueToMultiply: UInt64.from(8),
        });
        let proofKey = await RecursionProgram.verifyKey(publicInput, senderKey);
        let proofSig = await RecursionProgram.verifySig(
          { ...publicInput, valueToMultiply: UInt64.from(8).mul(8) },
          senderKey,
          Field(secret),
          proofKey
        );
        mergedProof = await RecursionProgram.mergeProofs(
          {
            ...publicInput,
            valueToMultiply: UInt64.from(8).mul(8).mul(8),
          },
          proofKey,
          proofSig
        );
      });
      it('succesfully verifies proofs within smart contract and transfers zkReward', async () => {
        await fetchAccounts([sender, rewardPublic]);
        let balanceBefore = deployToBerkeley
          ? (
              await fetchAccount({
                publicKey: sender,
                tokenId: zkReward.token.id,
              })
            ).account?.balance
          : Mina.getBalance(sender, zkReward.token.id);

        let tx = await Mina.transaction({ sender, fee: transactionFee }, () => {
          zkReward.rewardRecursiveProof(mergedProof);
        });
        tx.sign([senderKey]);
        await tx.prove();
        await (await tx.send()).wait({ maxAttempts: 50 });
        await waitUntilNextBlock();

        let balanceAfter = deployToBerkeley
          ? (
              await fetchAccount({
                publicKey: sender,
                tokenId: zkReward.token.id,
              })
            ).account?.balance
          : Mina.getAccount(sender, zkReward.token.id).balance;
        expect(balanceAfter).toEqual(balanceBefore?.add(88888888));
      });
    });
  }
  runTests();
});

function itLocal(name: string, f: () => void, timeout?: number) {
  if (testOnBerkeley == 'true') {
    console.log('Disabled test on Berkeley:' + name);
  } else {
    it(name, f, timeout);
  }
}
