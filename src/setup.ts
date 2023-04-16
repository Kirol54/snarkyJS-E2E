import {
  PrivateKey,
  PublicKey,
  UInt32,
  isReady,
  Mina,
  AccountUpdate,
  fetchAccount,
  fetchLastBlock,
} from 'snarkyjs';
import { Main, RewardToken, RecursionProgram } from '.';

import * as fs from 'fs/promises';
import * as path from 'path';

await isReady;
const proofsEnabled = false;
let transactionFee = 200000000;

export interface TestContext {
  Blockchain: any;
  senderKey: PrivateKey;
  sender: PublicKey;
  zkappAddress: PublicKey;
  zkAppPrivateKey: PrivateKey;
  zkapp: Main;
  zkReward: RewardToken;
  rewardPublic: PublicKey;
  testingAccounts: any;
  transactionFee: number;
  rewardTokenVerificationKey: any;
  proofsEnabled: boolean;
}

let ctx: TestContext;
export const deploy = async (deployToBerkeley = false) => {
  await isReady;
  let Blockchain, senderKey, sender: PublicKey, testingAccounts;
  if (deployToBerkeley) {
    console.log('Run on berkeley');
    Blockchain = Mina.Network({
      mina: 'https://proxy.berkeley.minaexplorer.com/graphql',
      archive: 'https://archive-node-api.p42.xyz/', // https://api.minascan.io/archive/berkeley/v1/graphql/ or https://archive.berkeley.minaexplorer.com/
    });
    Mina.setActiveInstance(Blockchain);

    const fileContent = await fs.readFile(path.resolve('keys/berkeley.json'), {
      encoding: 'utf-8',
    });
    const jsonData = JSON.parse(fileContent);

    senderKey = PrivateKey.fromBase58(jsonData.privateKey);
    sender = senderKey.toPublicKey();
    console.log('Sender addr:', sender.toBase58());
  } else {
    Blockchain = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Blockchain);

    senderKey = Blockchain.testAccounts[0].privateKey;
    sender = senderKey.toPublicKey();
    testingAccounts = Blockchain.testAccounts;
  }

  let zkAppPrivateKey = PrivateKey.random();
  let zkappAddress = zkAppPrivateKey.toPublicKey();

  console.log('Compiling ZkProgram ..');
  await RecursionProgram.compile();

  console.log('Compiling Main smart contract..');
  let { verificationKey } = await Main.compile();
  let zkapp = new Main(zkappAddress);
  console.log(`Deploying zkapp for public key ${zkappAddress.toBase58()}`);

  if (deployToBerkeley) {
    await fetchAccount({ publicKey: zkappAddress });
    await fetchAccount({ publicKey: sender });
  }
  let tx = await Mina.transaction(
    { sender: sender, fee: transactionFee },
    () => {
      AccountUpdate.fundNewAccount(sender);
      zkapp.deploy({ verificationKey });
    }
  );
  tx.sign([senderKey, zkAppPrivateKey]);
  console.log('Sending the transaction..');
  await (await tx.send()).wait({ maxAttempts: 70 });
  console.log('Compiling RewardToken smart contract..');
  let { verificationKey: rewardTokenVerificationKey } =
    await RewardToken.compile();

  let rewardKey = PrivateKey.random();
  let rewardPublic = rewardKey.toPublicKey();
  let zkReward = new RewardToken(rewardPublic);
  if (deployToBerkeley) {
    await fetchAccount({ publicKey: rewardPublic });
    await fetchAccount({ publicKey: sender });
  }
  tx = await Mina.transaction({ sender: sender, fee: transactionFee }, () => {
    AccountUpdate.fundNewAccount(sender);
    zkReward.deploy({ verificationKey: rewardTokenVerificationKey });
  });
  tx.sign([senderKey, rewardKey]);
  console.log('Sending the deployment zkReward tx..');
  await (await tx.send()).wait({ maxAttempts: 70 });
  console.log('deployed');
  if (deployToBerkeley) await waitForNextBlock();

  ctx = {
    Blockchain,
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
  };
};

export async function waitForNextBlock(
  retries = 50,
  interval = 20000
): Promise<void> {
  async function getCurrentBlockLength(): Promise<UInt32> {
    const { blockchainLength } = await fetchLastBlock();
    return blockchainLength;
  }
  // eslint-disable-next-line no-async-promise-executor
  await new Promise<void>(async (resolve, reject) => {
    const timeoutMilliseconds = retries * interval;
    const timeoutId = setTimeout(() => {
      reject(
        new Error(`Reached timeout after ${timeoutMilliseconds / 1000} seconds`)
      );
    }, timeoutMilliseconds); // timeout

    let startingHeight = await getCurrentBlockLength();
    // let counter = 1;
    const timerId = setInterval(async () => {
      const currentHeight = await getCurrentBlockLength();
      const hasIncreased = currentHeight.greaterThan(startingHeight);

      if (hasIncreased.toBoolean()) {
        const start = startingHeight.toString();
        const current = currentHeight.toString();
        console.log(
          `Block has increased from ${start} to ${current}, continuing...`
        );

        clearTimeout(timeoutId);
        clearInterval(timerId);
        resolve();
      }
      // console.log(`Retrying in ${interval / 1000} seconds, try ${counter++}`);
    }, interval);
  });
}
export const getCtx: (
  deployToBerkeley?: boolean
) => Promise<TestContext> = async (deployToBerkeley = false) => {
  if (!ctx) {
    await deploy(deployToBerkeley);
    if (!ctx) {
      throw new Error('Context not initialized.');
    }
  }
  return ctx;
};
