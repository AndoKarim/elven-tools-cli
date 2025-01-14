import { Address } from '@elrondnetwork/erdjs';
import fetch from 'cross-fetch';
import fs from 'fs';
import { exit, cwd } from 'process';
import ora from 'ora';
import pThrottle from 'p-throttle';
import prompts, { PromptObject } from 'prompts';
import {
  proxyGateways,
  chain,
  collectionNftOwnersTickerLabel,
  collectionNftOwnersOnlyUniqLabel,
  collectionNftOwnersNoSmartContractsLabel,
  collectionNftOwnersCallsPerSecond,
} from './config';

interface NftToken {
  owner: string;
}

const MAX_SIZE = 100;

const spinner = ora('Processing, please wait...');

export const collectionNftOwners = async () => {
  let tokensNumber = '';

  const promptsQuestions: PromptObject[] = [
    {
      type: 'text',
      name: 'collectionTicker',
      message: collectionNftOwnersTickerLabel,
      validate: (value) => (!value ? 'Required!' : true),
    },
    {
      type: 'select',
      name: 'onlyUniq',
      message: collectionNftOwnersOnlyUniqLabel,
      choices: [
        { title: 'No', value: false },
        { title: 'Yes', value: true },
      ],
    },
    {
      type: 'select',
      name: 'noSmartContracts',
      message: collectionNftOwnersNoSmartContractsLabel,
      choices: [
        { title: 'Yes', value: true },
        { title: 'No', value: false },
      ],
    },
  ];

  try {
    const { collectionTicker, onlyUniq, noSmartContracts } = await prompts(
      promptsQuestions
    );

    if (!collectionTicker) {
      console.log(
        'You have to provide CIDs, amount of tokens and selling price!'
      );
      exit(9);
    }

    const addressesArr: string[][] = [];

    const response = await fetch(
      `${proxyGateways[chain]}/collections/${collectionTicker}/nfts/count`
    );

    tokensNumber = await response.text();

    console.log(`There is ${tokensNumber} tokens in that collection.`);

    if (Number(tokensNumber) === 0) {
      exit(9);
    }

    spinner.start();

    const makeCalls = () =>
      new Promise<string[]>((resolve) => {
        const repeats = Math.ceil(Number(tokensNumber) / MAX_SIZE);

        const throttle = pThrottle({
          limit: collectionNftOwnersCallsPerSecond,
          interval: 1000,
        });

        let madeRequests = 0;

        const throttled = throttle(async (index: number) => {
          const response = await fetch(
            `${
              proxyGateways[chain]
            }/collections/${collectionTicker}/nfts?withOwner=true&from=${
              index * MAX_SIZE
            }&size=${MAX_SIZE}`
          );
          const data = await response.json();
          const addrs = data.map((token: NftToken) => token.owner);
          if (index >= Math.ceil(repeats / 2)) {
            spinner.text = 'Almost there...';
          }
          addressesArr.push(addrs);
          if (madeRequests >= repeats - 1) {
            spinner.stop();
            const flatten = addressesArr.flat();
            return resolve(flatten);
          }
          if (madeRequests < repeats) madeRequests++;
        });

        for (let step = 0; step < repeats; step++) {
          (async () => throttled(step))();
        }
      });

    let addresses: string[] = await makeCalls();

    if (onlyUniq) {
      addresses = [...new Set(addresses)];
    }

    if (noSmartContracts) {
      addresses = addresses.filter(
        (address) => !Address.fromString(address).isContractAddress()
      );
    }

    const addressesLength = addresses.length;

    if (addressesLength > 0) {
      fs.writeFileSync(
        `${cwd()}/nft-collection-owners.json`,
        JSON.stringify(addresses, null, 2),
        'utf8'
      );

      let additionalInfo = '';

      if (onlyUniq || noSmartContracts) {
        additionalInfo = `${onlyUniq ? ' Only uniq addresses.' : ''}${
          noSmartContracts ? ' Without smart contract addresses.' : ''
        }`;
      }
      console.log(`Done, ${addressesLength} addresses saved.${additionalInfo}`);
    }
  } catch (e) {
    console.log((e as Error)?.message);
  }
};
