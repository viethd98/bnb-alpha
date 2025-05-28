require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { Web3 } = require("web3");
const moment = require("moment");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// Khởi tạo Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
  polling: true,
  request: {
    proxy: 'http://vietch123:Vietch123@82.21.51.173:7936'
  }
});

// Khởi tạo Web3 với BNB Chain
const web3 = new Web3(process.env.BNB_CHAIN_RPC_URL);

// Đường dẫn file JSON lưu trữ ví và user
const DATA_DIR = path.join(__dirname, "data");
const WALLETS_FILE = path.join(DATA_DIR, "tracked_wallets.json");

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Cấu trúc lưu trữ: Map<chatId, { wallets: Set<string>, user: { id: number, username: string, first_name: string } }>
const trackedData = new Map();

// Hàm lưu danh sách ví và user vào file JSON
function saveData() {
  try {
    const data = {};
    trackedData.forEach((info, chatId) => {
      // Chuyển chatId thành string khi lưu
      data[chatId.toString()] = {
        wallets: Array.from(info.wallets),
        user: info.user,
      };
    });
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
    console.log("Đã lưu dữ liệu vào file:", WALLETS_FILE);
    console.log("Dữ liệu đã lưu:", data);
  } catch (error) {
    console.error("Lỗi khi lưu dữ liệu:", error);
  }
}

// Hàm đọc danh sách ví và user từ file JSON
function loadData() {
  try {
    if (fs.existsSync(WALLETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(WALLETS_FILE));
      console.log("Dữ liệu đọc từ file:", data);

      Object.entries(data).forEach(([chatId, info]) => {
        // Chuyển chatId thành number khi đọc
        trackedData.set(Number(chatId), {
          wallets: new Set(info.wallets),
          user: info.user,
        });
      });
      console.log("Số lượng user đã load:", trackedData.size);
      trackedData.forEach((info, chatId) => {
        console.log(
          `User ${chatId} có ${info.wallets.size} ví:`,
          Array.from(info.wallets)
        );
      });
    } else {
      console.log("Chưa có file dữ liệu, sẽ tạo mới khi có dữ liệu");
    }
  } catch (error) {
    console.error("Lỗi khi đọc file dữ liệu:", error);
  }
}

// Tải dữ liệu khi khởi động
loadData();

// Hàm kiểm tra trạng thái giao dịch
async function checkTransactionStatus(txHash) {
  try {
    const response = await axios.get("https://api.bscscan.com/api", {
      params: {
        module: "transaction",
        action: "gettxreceiptstatus",
        txhash: txHash,
        apikey: process.env.BSCSCAN_API_KEY,
      },
    });
    console.log(`Transaction ${txHash} status response:`, response.data);
    return response.data.result.status === "1";
  } catch (error) {
    console.error("Lỗi khi kiểm tra trạng thái giao dịch:", error);
    return false;
  }
}

// Test specific transaction
async function testTransaction() {
  const txHash = "0x619d1b9762b946cee2bf13546b66ed1ed660b3f12111202ef915276d02adae22";
  const status = await checkTransactionStatus(txHash);
  console.log(`Transaction ${txHash} is successful:`, status);
}

// Call test function
// testTransaction();

// Hàm lấy danh sách token transfers từ BscScan
async function getTokenTransfers(walletAddress) {
  try {
    // Lấy thời gian hiện tại theo UTC
    const now = moment.utc();
    
    // Tính thời gian bắt đầu và kết thúc của ngày hiện tại theo UTC
    const startOfDay = now.clone().startOf('day');
    const endOfDay = now.clone().endOf('day');

    // Lấy timestamp của đầu ngày và cuối ngày
    const startTimestamp = Math.floor(startOfDay.valueOf() / 1000);
    const endTimestamp = Math.floor(endOfDay.valueOf() / 1000);

    console.log('Time range:', {
      start: startOfDay.format('YYYY-MM-DD HH:mm:ss'),
      end: endOfDay.format('YYYY-MM-DD HH:mm:ss'),
      startTimestamp,
      endTimestamp
    });

    const response = await axios.get("https://api.bscscan.com/api", {
      params: {
        module: "account",
        action: "tokentx",
        address: walletAddress,
        startblock: 0,
        endblock: 99999999,
        sort: "desc",
        apikey: process.env.BSCSCAN_API_KEY,
      },
    });

    if (response.data.status === "1" && response.data.result.length > 0) {
      // Lọc giao dịch trong ngày hiện tại và chỉ lấy giao dịch OUT (BSC-USD)
      const filteredTransactions = [];
      
      for (const tx of response.data.result) {
        const txTimestamp = parseInt(tx.timeStamp);
        const isInTimeRange =
          txTimestamp >= startTimestamp && txTimestamp <= endTimestamp;
        const isOutTransaction =
          tx.from.toLowerCase() === walletAddress.toLowerCase();
        const isBSCUSD = tx.tokenSymbol === "BSC-USD";

        // Kiểm tra giá trị giao dịch
        const value =
          parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal));
        const isValidValue = value > 50;

        // Kiểm tra địa chỉ hợp lệ (không phải địa chỉ 0x0000...)
        const isValidAddress =
          tx.to !== "0x0000000000000000000000000000000000000000";

        if (isInTimeRange && isOutTransaction && isBSCUSD && isValidValue && isValidAddress) {
          // Kiểm tra trạng thái giao dịch
          const isSuccessful = await checkTransactionStatus(tx.hash);
          if (isSuccessful) {
            filteredTransactions.push(tx);
          }
        }
      }

      return filteredTransactions;
    }
    return [];
  } catch (error) {
    console.error("Lỗi khi lấy giao dịch:", error);
    return [];
  }
}

// Hàm tính toán thống kê
async function calculateStats(walletAddress) {
  try {
    const transfers = await getTokenTransfers(walletAddress);
    let totalBSCUSD = 0;
    let transactions = [];

    for (const tx of transfers) {
        console.log('tx', tx);
      // Chỉ xử lý giao dịch BSC-USD và với contract cụ thể
      const binanceDexContract = '0xb300000b72DEAEb607a12d5f54773D1C19c7028d';
      if (tx.tokenSymbol === "BSC-USD" && tx.to.toLowerCase() === binanceDexContract.toLowerCase()) {
        const value = parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal));
        // Chỉ thêm giao dịch có giá trị > 0
        if (value > 0) {
          totalBSCUSD += value;
          transactions.push({
            time: moment.unix(tx.timeStamp).toISOString(),
            value: value,
            hash: tx.hash,
          });
        }
      }
    }
    
    return {
      totalBSCUSD,
      transactions,
    };
  } catch (error) {
    console.error("Lỗi khi tính toán thống kê:", error);
    return { totalBSCUSD: 0, transactions: [] };
  }
}

// Xử lý lệnh /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const data = trackedData.get(chatId);

  let message = "Việt đại ca chào anh em, dùng lệnh sau để track nhé!\n\n";
  message += "Các lệnh:\n";
  message += "/track <địa_chỉ_ví> - Thêm ví vào danh sách theo dõi\n";
  message += "/list - Xem danh sách ví đang theo dõi\n";
  message += "/stats - Xem thống kê chi tiêu BSC-USD hôm nay của tất cả ví\n";
  message += "/remove <địa_chỉ_ví> - Xóa ví khỏi danh sách theo dõi\n";
  message += "/clear - Xóa tất cả ví khỏi danh sách theo dõi\n\n";

  if (data && data.wallets.size > 0) {
    message += `Bạn đang theo dõi ${data.wallets.size} ví.\n`;
    message += "Sử dụng /list để xem chi tiết.";
  } else {
    message += "Bạn chưa theo dõi ví nào.\n";
    message += "Sử dụng /track <địa_chỉ_ví> để thêm ví.";
  }

  bot.sendMessage(chatId, message);
});

// Xử lý lệnh /track
bot.onText(/\/track (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const walletAddress = match[1].trim();
  const user = {
    id: msg.from.id,
    username: msg.from.username || "unknown",
    first_name: msg.from.first_name || "unknown",
  };

  if (!web3.utils.isAddress(walletAddress)) {
    return bot.sendMessage(
      chatId,
      "❌ Địa chỉ ví không hợp lệ. Vui lòng cung cấp địa chỉ BNB Chain hợp lệ."
    );
  }

  // Khởi tạo dữ liệu nếu chưa có
  if (!trackedData.has(chatId)) {
    trackedData.set(chatId, {
      wallets: new Set(),
      user: user,
    });
  }

  const data = trackedData.get(chatId);
  if (data.wallets.has(walletAddress)) {
    return bot.sendMessage(chatId, "⚠️ Ví này đã được theo dõi.");
  }

  data.wallets.add(walletAddress);
  // Cập nhật thông tin user
  data.user = user;
  // Lưu vào file
  saveData();

  console.log(`Đã thêm ví ${walletAddress} cho user ${chatId}`);
  console.log("Dữ liệu hiện tại:", Array.from(trackedData.entries()));

  bot.sendMessage(
    chatId,
    `✅ Đã thêm ví vào danh sách theo dõi:\n` +
      `🔹 ${walletAddress}\n\n` +
      `Sử dụng /stats để xem thống kê chi tiêu BSC-USD hôm nay.`
  );
});

// Xử lý lệnh /list
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  const data = trackedData.get(chatId);

  if (!data || data.wallets.size === 0) {
    return bot.sendMessage(
      chatId,
      "Chưa có ví nào được theo dõi. Sử dụng /track <địa_chỉ_ví> để thêm ví."
    );
  }

  let message = "Danh sách ví đang theo dõi:\n\n";
  let index = 1;
  for (const wallet of data.wallets) {
    message += `${index}. ${wallet}\n`;
    index++;
  }

  bot.sendMessage(chatId, message);
});

// Xử lý lệnh /stats
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const data = trackedData.get(chatId);

  if (!data || data.wallets.size === 0) {
    return bot.sendMessage(
      chatId,
      "Chưa có ví nào được theo dõi. Sử dụng /track <địa_chỉ_ví> để thêm ví."
    );
  }

  let totalBSCUSD = 0;
  let allTransactions = [];

  // Tính toán thống kê cho từng ví
  for (const wallet of data.wallets) {
    const stats = await calculateStats(wallet);
    totalBSCUSD += stats.totalBSCUSD;
    allTransactions.push(
      ...stats.transactions.map((tx) => ({
        ...tx,
        wallet,
      }))
    );
  }

  // Sắp xếp tất cả giao dịch theo thời gian
  allTransactions.sort(
    (a, b) => moment(b.time).valueOf() - moment(a.time).valueOf()
  );

  let message = `📊Vol Mua Binance Alpha\n\n`;
  message += `Tổng tiền: ${totalBSCUSD.toFixed(2)} BSC-USD\n`;
  message += `Số lượng giao dịch: ${allTransactions.length}\n\n`;

  // Thống kê theo từng ví
  let index = 1;
  for (const wallet of data.wallets) {
    const walletStats = allTransactions.filter((tx) => tx.wallet === wallet);
    const walletTotal = walletStats.reduce((sum, tx) => sum + tx.value, 0);

    message += `Ví ${wallet}:\n`;
    message += `Tổng vol: ${walletTotal.toFixed(2)} BSC-USD\n`;
    message += `Số lượng tx: ${walletStats.length}\n`;

    if (walletStats.length > 0) {
      // Lấy giao dịch đầu tiên của ví
      const firstTx = walletStats[walletStats.length - 1];
      message += `⏰ Tx đầu tiên trong ngày: [${moment.utc(firstTx.time)
        .utcOffset(7)
        .format("DD/MM/YYYY HH:mm:ss")}] UTC+7 - ${firstTx.value.toFixed(
        2
      )} BSC-USD\n`;

      // Lấy giao dịch mới nhất của ví
      const latestTx = walletStats[0];
      message += `🔄 Tx cuối cùng trong ngày: [${moment.utc(latestTx.time)
        .utcOffset(7)
        .format("DD/MM/YYYY HH:mm:ss")}] UTC+7 - ${latestTx.value.toFixed(
        2
      )} BSC-USD\n`;
    }
    message += "\n";
    index++;
  }

  bot.sendMessage(chatId, message);
});

// Xử lý lệnh /remove
bot.onText(/\/remove (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const walletAddress = match[1].trim();
  const data = trackedData.get(chatId);

  if (!data || !data.wallets.has(walletAddress)) {
    return bot.sendMessage(
      chatId,
      "⚠️ Ví này không có trong danh sách theo dõi."
    );
  }

  data.wallets.delete(walletAddress);
  // Lưu vào file
  saveData();

  bot.sendMessage(
    chatId,
    `✅ Đã xóa ví khỏi danh sách theo dõi:\n🔹 ${walletAddress}`
  );
});

// Xử lý lệnh /clear
bot.onText(/\/clear/, (msg) => {
  const chatId = msg.chat.id;
  trackedData.delete(chatId);
  // Lưu vào file
  saveData();

  bot.sendMessage(chatId, "Đã xóa tất cả ví khỏi danh sách theo dõi.");
});

// Xử lý lỗi
bot.on("polling_error", (error) => {
  console.error("Lỗi polling:", error);
});

console.log("Bot đang chạy...");
