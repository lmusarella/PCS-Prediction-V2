
const {GLOBAL_CONFIG} = require("../bot-configuration/bot-configuration");
const {BINANCE_API_BNB_USDT_URL} = require("../bot-configuration/constants/api.constants");
const {EVENTS} = require("../bot-configuration/constants/smart-contract.constants");
const {BNB_CRYPTO, BNB_ROUND_HISTORY_FILE_NAME, BNB_STATISTICS_HISTORY_FILE_NAME} = require("../bot-configuration/constants/bot.constants");
const {saveRoundInHistory, parseRoundDataFromSmartContract, saveStatisticsInHistory, getNewStatistics} = require('../bot-modules/history.module');
const {getBinancePrice} = require('../bot-modules/external-data/binance.module');
const {getRoundDataBNB, bnbPredictionGameSmartContract, isClaimableRoundBNB, claimRewardsBNB, getBNBMinBetAmount} = require('../bot-modules/smart-contracts/bnb-pcs-prediction-smart-contract.module');
const {excuteStrategy, checkProfitTargetReached, checkTradingStrategy, betDownStrategy, betUpStrategy, isCopyTradingStrategySelected, checkEndRoundResult} = require('../bot-modules/trading-strategy.module');
const {checkBalance, getPersonalWalletAddress, getPersonalBalance} = require('../bot-modules/wallet/wallet.module');
const {formatEther} = require('../bot-modules/utils.module');
const sleep = require("util").promisify(setTimeout);

//Global Configurations
const BET_CONFIG = GLOBAL_CONFIG.BET_CONFIGURATION;
const STRATEGY_CONFIG = GLOBAL_CONFIG.STRATEGY_CONFIGURATION;
const COPY_TRADING_STRATEGY_CONFIG = GLOBAL_CONFIG.STRATEGY_CONFIGURATION.COPY_TRADING_STRATEGY;

//Rounds played
const roundsEntered = {};

const initBot = async () => {
  checkTradingStrategy(BNB_CRYPTO);
  const minBetAmount = await getBNBMinBetAmount();
  await checkBalance(formatEther(minBetAmount));
  console.log(`--------------------------------`);
  console.log(`🟢 Bot started`);
  console.log(`--------------------------------`);
}

initBot();

//Listener on "StartRound" event from {@bnbPredictionGameSmartContract}
bnbPredictionGameSmartContract.on(EVENTS.START_ROUND_EVENT, async (epoch) => {
  console.log("😍 Starting round: " + epoch.toString()); 
  await checkProfitTargetReached(BNB_STATISTICS_HISTORY_FILE_NAME);
  if(!isCopyTradingStrategySelected()) {
    roundsEntered[epoch.toString()] = true;
    console.log("🕑 Waiting: " + (STRATEGY_CONFIG.WAITING_TIME / 60000).toFixed(1) + " minutes");
    console.log(`--------------------------------`);
    await sleep(STRATEGY_CONFIG.WAITING_TIME);
    await excuteStrategy(epoch, BET_CONFIG.BET_AMOUNT_BNB, BNB_CRYPTO);
  } else {
    console.log(`🕑 Waiting for ${COPY_TRADING_STRATEGY_CONFIG.WALLET_ADDRESS_TO_EMULATE} 🟢 BetBull or 🔴 BetBear events`);
    console.log(`--------------------------------`);
  }
});

//Listener on "EndRound" event from {@bnbPredictionGameSmartContract}
bnbPredictionGameSmartContract.on(EVENTS.END_ROUND_EVENT, async (epoch) => {
  if(roundsEntered[epoch.toString()]) {
    console.log("⛔ Ending round: " + epoch.toString());
    const isClaimableRound = await isClaimableRoundBNB(epoch);
    if(isClaimableRound && STRATEGY_CONFIG.CLAIM_REWARDS) {
      console.log(`💲 Collecting winnings...`);
      await claimRewardsBNB([epoch]);
    }
    const bnbBinancePrice = await getBinancePrice(BINANCE_API_BNB_USDT_URL);
    const personalBalance = await getPersonalBalance();
    const roundData = await getRoundDataBNB(epoch);
    const roundsHistoryData = await saveRoundInHistory(parseRoundDataFromSmartContract(epoch, roundData), BNB_ROUND_HISTORY_FILE_NAME);
    const statistics = await saveStatisticsInHistory(getNewStatistics(roundsHistoryData, bnbBinancePrice),  BNB_STATISTICS_HISTORY_FILE_NAME);
    checkEndRoundResult(statistics, epoch, personalBalance, BNB_CRYPTO, bnbBinancePrice);
  }
});

//Listener on "BetBear" event from {@bnbPredictionGameSmartContract}
bnbPredictionGameSmartContract.on(EVENTS.BET_BEAR_EVENT,async (sender, epoch) => {
    if(isCopyTradingStrategySelected() && sender == COPY_TRADING_STRATEGY_CONFIG.WALLET_ADDRESS_TO_EMULATE){
        console.log(`🔮 Friend ${COPY_TRADING_STRATEGY_CONFIG.WALLET_ADDRESS_TO_EMULATE} Prediction: DOWN 🔴 for round: ${epoch.toString()}`);
        roundsEntered[epoch.toString()] = true;                            
        await betDownStrategy(BET_CONFIG.BET_AMOUNT_BNB, epoch, BNB_CRYPTO);              
    }
});

//Listener on "BetBull" event from {@bnbPredictionGameSmartContract}
bnbPredictionGameSmartContract.on(EVENTS.BET_BULL_EVENT, async(sender, epoch) =>{       
    if(isCopyTradingStrategySelected() && sender == COPY_TRADING_STRATEGY_CONFIG.WALLET_ADDRESS_TO_EMULATE){ 
        console.log(`🔮 Friend ${COPY_TRADING_STRATEGY_CONFIG.WALLET_ADDRESS_TO_EMULATE} Prediction: UP 🟢 for round: ${epoch.toString()}`);
        roundsEntered[epoch.toString()] = true;                       
        await betUpStrategy(BET_CONFIG.BET_AMOUNT_BNB, epoch, BNB_CRYPTO);  
    }
});

//Listener on "Claim" event from {@cakePredictionGameSmartContract}
bnbPredictionGameSmartContract.on(EVENTS.CLAIM_EVENT, async(sender, epoch, addedRewards) =>{  
  if(STRATEGY_CONFIG.CLAIM_REWARDS) {
    const personalWalletAddress = await getPersonalWalletAddress();     
    if(sender == personalWalletAddress){ 
        console.log(`🗿 Successful collect ${formatEther(addedRewards)} ${BNB_CRYPTO} from round: ${epoch.toString()}`);
    }
  }
});