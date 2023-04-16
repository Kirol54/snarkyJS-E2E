# Snarkyjs E2E Testing

## Description

This repository contains Smart Contracts and tests for end-to-end testing of SnarkyJS.
Contract Main is the main contract that is used, with MainV2 as upgrade to it.
Reccursion Program is used to test recursion with Reward token that also is used to test composability.

All testing surface area have been covered throughout the Smart Contracts.

## How to build

```sh
npm run build
```

## How to run tests

To run tests on Mina LocalBlockchain (to disable proofs see src/setup.ts#L18)

```sh
npm test
```

To run tests on Berkeley testnet

```sh
TEST_ON_BERKELEY=true npm test
```

There are 7 tests that are skipped on Berkeley testnet due to issue of handling failures.
The test are called with `itLocal`

## Estimate time needed to run the tests

- Mina Berkeley: 3h 8min (latest run)

Ryzen 9

- Mina LocalBlockchain: 5 Minutes and 23 Seconds (323.623 s)
- Mina LocalBlockchain with proofs: 11 Minutes and 52 Seconds (713.612 s)

M1 Pro

- Mina LocalBlockchain: 7 Minutes and 17 Seconds (438.348 s)
- Mina LocalBlockchain with proofs: 20 Minutes and 7 Seconds (1207.587 s)

## How to run coverage

```sh
npm run coverage
```

## License

[Apache-2.0](LICENSE)
