importClass(android.content.Context);
importClass(android.provider.Settings);

let {
    companyName,
    clockRules,
    clockInRange,
    clockOutRange,
    dingAccount,
    dingPassword,
    phoneUnlockPassword,
    waitingTimeDelay,
    notifyForQMsg,
    debug
} = hamibot.env;
const w = device.width;
const h = device.height;
const maxSwipeNum = 50;

let dingConf = storages.create("Ding-Conf");
let swipeConfName = device.getAndroidId() + "_SWIPE_TIME";
let holidayConfName = "HOLIDAY_APPLY_" + new Date().getFullYear()
let holidayApi = "http://timor.tech/api/holiday/year?week=Y";

// 防止息屏
threads.start(function () {
    setInterval(() => {
        toast("防止锁屏策略");
    }, getLoopTime());
});

// 根据当前自动息屏时间获取循环时间
function getLoopTime() {
    let lockTime = Settings.System.getInt(context.getContentResolver(), Settings.System.SCREEN_OFF_TIMEOUT);
    if (null == lockTime || "" === lockTime || "undefined" === lockTime) {
        return 8000;
    }
    return lockTime / 2;
}

if (!clockInRange) {
    toastLog("请设置上班打卡时间范围");
    exitScript();
}

if (!clockOutRange) {
    toastLog("请设置下班打卡时间范围");
    exitScript();
}

if (!waitingTimeDelay) {
    waitingTimeDelay = 30
}

if (debug === "model_1") {
    console.clear();
    console.show();
}

if ((clockRules === "rule_1" || clockRules === "rule_4" || clockRules === "rule_5") && !dingConf.contains(holidayConfName)) {
    setHoliday();
}

// 程序入口
(function () {
    // 1. 解锁屏幕
    unlockScreen();

    // 2. 检查配置
    checkConfiguration();

    // 3. 检查权限
    checkPermissions();

    // 4. 进入钉钉页面(极速模式打卡)
    openDingDingSoftware();

    // 5. 获取结果
    queryClockInResults();

    // 6. 结束程序
    exitScript();
})()

// 尝试重开
function tryToRestart() {
    openDingDingSoftware();
    queryClockInResults();
    exitScript();
}

// 解锁屏幕
function unlockScreen() {
    // 唤醒屏幕
    device.wakeUpIfNeeded();

    // 检查手机锁屏状态
    function screenLockedStatus() {
        let km = context.getSystemService(Context.KEYGUARD_SERVICE);
        return km.isKeyguardLocked() && km.isKeyguardSecure();
    }

    if (!screenLockedStatus()) {
        log("当前屏幕无需解锁");
        swipeUp();
        return;
    }
    swipeUp();
    sleep(1000);
    if (phoneUnlockPassword) {
        passwordToUnlock();
    }
    log("屏幕解锁完成");
}

// 密码解锁
function passwordToUnlock() {
    if (text(2).exists() && text(5).exists() && text(8).exists()) {
        for (let i = 0; i < phoneUnlockPassword.length; i++) {
            click(phoneUnlockPassword.charAt(i))
            sleep(200);
        }
    } else if (desc(2).exists() && desc(5).exists() && desc(8).exists()) {
        for (let i = 0; i < phoneUnlockPassword.length; i++) {
            click(phoneUnlockPassword.charAt(i))
            sleep(200);
        }
    } else {
        sendNotifyAndExitScript("屏幕解锁失败");
    }
}

// 上滑解锁
function swipeUp() {
    if (dingConf.contains(swipeConfName)) {
        let swipeTime = dingConf.get(swipeConfName);
        gesture(swipeTime, [w / 2, h * 0.9], [w / 2, h * 0.1]);
        sleep(1000);
        if (judgeSwipeUpResults()) {
            return;
        }
    }

    if (swipeUpOperation()) {
        log("上滑成功");
    } else {
        toastLog("当前程序无法上滑至桌面或密码输入界面");
        exitScript();
    }
}

// 判断向上滑动结果
function judgeSwipeUpResults() {
    let km = context.getSystemService(Context.KEYGUARD_SERVICE);

    // 判断是否在锁屏界面
    if (!km.inKeyguardRestrictedInputMode()) {
        return true;
    }
    for (let i = 0; i < 10; i++) {
        if (!text(i).exists() && !desc(i).exists()) {
            return false;
        }
    }
    return true;
}

// 上滑操作
function swipeUpOperation() {
    let swipeTime = 0;
    let addTime = 20;
    for (let i = 0; i < maxSwipeNum; i++) {
        swipeTime += addTime;
        gesture(swipeTime, [w / 2, h * 0.9], [w / 2, h * 0.1]);
        sleep(1000);
        if (judgeSwipeUpResults()) {
            dingConf.put(swipeConfName, swipeTime);
            return true;
        }
    }
    return false;
}

// 检查配置
function checkConfiguration() {
    // 检查当前是否在打卡时间段内
    let now = new Date();
    let yearMonthDay = getDateTime(1)
    let clockInWithStartHMS = clockInRange.split("-")[0] + ":00"
    let clockInWithEndHMS = clockInRange.split("-")[1] + ":00"
    let clockOutWithStartHMS = clockOutRange.split("-")[0] + ":00"
    let clockOutWithEndHMS = clockOutRange.split("-")[1] + ":00"
    let clockInRangeForStart = new Date(yearMonthDay + " " + clockInWithStartHMS)
    let clockInRangeForEnd = new Date(yearMonthDay + " " + clockInWithEndHMS)
    let clockOutRangeForStart = new Date(yearMonthDay + " " + clockOutWithStartHMS)
    let clockOutRangeForEnd = new Date(yearMonthDay + " " + clockOutWithEndHMS)

    if (!(now > clockInRangeForStart && now < clockInRangeForEnd) &&
        !(now > clockOutRangeForStart && now < clockOutRangeForEnd)) {
        sendNotifyAndExitScript("当前时间段并非指定打卡时间");
    }

    // 检查是否需要跳过节假日或周末
    if (clockRules === "rule_1") {
        let holidayArray = dingConf.get(holidayConfName);

        if (holidayArray.indexOf(getDateTime(2)) !== -1) {
            sendNotifyAndExitScript("今天是节假日，无需打卡哦~");
        }
    } else if (clockRules === "rule_2") {
        let week = new Date().getDay();
        if (week === 6 || week === 0) {
            sendNotifyAndExitScript("今天是周末，无需打卡哦~");
        }
    } else if (clockRules === "rule_3") {
        let week = new Date().getDay();
        if (week === 0) {
            sendNotifyAndExitScript("今天是周末，无需打卡哦~");
        }
    } else if (clockRules === "rule_4") {
        let week = new Date().getDay();
        let holidayArray = dingConf.get(holidayConfName);
        if (holidayArray.indexOf(getDateTime(2)) !== -1 || week === 6 || week === 0) {
            sendNotifyAndExitScript("今天是节假日或周末，无需打卡哦~");
        }
    } else if (clockRules === "rule_5") {
        let week = new Date().getDay();
        let holidayArray = dingConf.get(holidayConfName);
        if (holidayArray.indexOf(getDateTime(2)) !== -1 || week === 0) {
            sendNotifyAndExitScript("今天是节假日或周末，无需打卡哦~");
        }
    }
}

// 检查权限
function checkPermissions() {
    // 检查无障碍权限
    if (auto.service == null) {
        toastLog("请先打开无障碍服务，再来运行脚本吧！");
        sleep(3000);
        app.startActivity({action: "android.settings.ACCESSIBILITY_SETTINGS"});
        exitScript();
    }

    // 检查截图权限
    threads.start(function () {
        let timer = setInterval(function () {
            if (text("立即开始").clickable(true).exists()) {
                text("立即开始").clickable(true).findOne().click();
                clearInterval(timer);
            } else if (desc("立即开始").clickable(true).exists()) {
                desc("立即开始").clickable(true).findOne().click();
                clearInterval(timer);
            }
        }, 500);
    });

    if (!requestScreenCapture()) {
        toastLog("申请截图权限失败");
        exitScript();
    }

    toastLog("权限检查完毕");
}

// 打开打卡页面
function openDingDingSoftware() {
    toastLog("识别钉钉页面中");

    // 1. 打开软件
    launch("com.alibaba.android.rimet");

    // 2. 判断当前页面
    let page = loopWaitingForPage()
    log("当前页面为：", page);
    switch (page) {
        case "login":
            // 检查登录状态
            checkLoginStatus();
            openDingDingSoftware();
            break
        case "home":
            // 进入打卡页面
            toastLog("正在进入打卡界面");
            let intent = app.intent({
                action: "VIEW",
                data: "dingtalk://dingtalkclient/page/link?url=https://attend.dingtalk.com/attend/index.html"
            });
            app.startActivity(intent);
            sleep(2000)

            // 选择公司
            selectCompany();
            break
        case "clockIn":
            toastLog("当前已在打卡界面");
            break
        case "selectCompany":
            selectCompany();
            break
        case "restDay":
            break
        default:
            toastLog("界面识别失败，尝试重新打开钉钉");
            killApp("钉钉");
            openDingDingSoftware();
    }
}

// 等待进入钉钉界面
function loopWaitingForPage() {
    let sTime = new Date().getTime();
    let delay = waitingTimeDelay * 1000;

    while ((new Date().getTime() - sTime) < delay) {
        if (text("登录").exists() || desc("登录").exists()) {
            return "login";
        } else if (text("登录").exists() || desc("登录").exists() ||
            text("消息").exists() || desc("消息").exists() ||
            text("协作").exists() || desc("协作").exists() ||
            text("通讯录").exists() || desc("通讯录").exists() ||
            text("我的").exists() || desc("我的").exists()) {
            return "home";
        } else if ((text("上班09:00").exists() || desc("上班09:00").exists()) &&
            (text("下班18:00").exists() || desc("下班18:00").exists())) {
            return "clockIn";
        } else if (text("请选择你要进入的考勤组织").exists() || desc("请选择你要进入的考勤组织").exists()) {
            return "selectCompany";
        } else if (text("今日休息").exists() || desc("今日休息").exists()) {
            return "restDay";
        }
        sleep(1000);
    }

    killApp("钉钉");
    toastLog("页面卡死，尝试重新打开应用");
    tryToRestart();
}

// 杀掉应用
function killApp(name) {
    var packageName = app.getPackageName(name);
    app.openAppSetting(packageName);
    sleep(1000);
    while (true) {
        if (text("结束运行").exists()) {
            click("结束运行");
            sleep(500);
            while (true) {
                if (text("确定").exists()) {
                    click("确定");
                    sleep(500)
                    break;
                }
            }
            break;
        } else if (text("强行停止").exists()) {
            click("强行停止");
            sleep(500);
            while (true) {
                if (text("确定").exists()) {
                    click("确定");
                    sleep(500)
                    break;
                }
            }
            break;
        }
    }
    back();
    home();
    sleep(2000);
}

// 检查是否需要登录
function checkLoginStatus() {
    if (text("密码登录").clickable(true).exists()) {
        text("密码登录").clickable(true).findOne().click();
    } else if (desc("密码登录").clickable(true).exists()) {
        desc("密码登录").clickable(true).findOne().click();
    }

    if (text("忘记密码").clickable(true).exists() || desc("忘记密码").clickable(true).exists()) {
        if (!dingAccount || !dingPassword) {
            toastLog("当前未登录，请输入钉钉登录账号及密码");
            exitScript();
        }

        if (id("et_phone_input").exists() && id("et_pwd_login").exists()) {
            id("et_phone_input").findOne().setText(dingAccount);
            sleep(1000);
            id("et_pwd_login").findOne().setText(dingPassword);
            log("使用ID选择输入");
        } else {
            setText(0, dingAccount);
            sleep(1000);
            setText(1, dingPassword);
            log("使用setText输入");
        }

        // 勾选协议
        toastLog("勾选协议");
        if (id("cb_privacy").exists()) {
            id("cb_privacy").findOne().click()
            toastLog("勾选协议成功");
        }

        // Android版本低于7.0
        if (device.sdkInt < 24) {
            let pageUIObj = [];
            if (id("btn_next").clickable(true).exists()) {
                id("btn_next").clickable(true).findOne().click();
            } else {
                if (text("忘记密码").exists()) {
                    pageUIObj = text("忘记密码").findOne().parent().parent().children();
                } else {
                    pageUIObj = desc("忘记密码").findOne().parent().parent().children();
                }
                if (pageUIObj.length === 5) {
                    let loginBtn = pageUIObj[3].children()[0];
                    loginBtn.click();
                } else {
                    toastLog("找不到登录按钮，请联系脚本作者!");
                }
            }
        } else {
            // 获取登录按钮坐标
            log("寻找登录按钮坐标");
            if (className("android.widget.FrameLayout").clickable(true).exists()) {
                log("开始登录");
                className("android.widget.FrameLayout").clickable(true).findOne().click()
            } else {
                toastLog("找不到登录按钮，请联系脚本作者!");
            }
        }
        sleep(3 * 1000);
        toastLog("登录成功");
    } else {
        toastLog("无需登录");
    }
}

// 选择公司
function selectCompany() {
    // 选择公司
    if ("" === companyName || null == companyName) {
        return;
    }
    let delay = waitingTimeDelay * 1000;
    let flagStr = "请选择你要进入的考勤组织";
    let find = false;
    let sTime = new Date().getTime();
    while ((new Date().getTime() - sTime) < delay) {
        if (text(flagStr).exists() || desc(flagStr).exists()) {
            toastLog("选择设定公司");
            if (textContains(companyName).clickable(true).exists()) {
                find = true;
                textContains(companyName).findOne().click();
                toastLog("选择公司：" + companyName);
                return;
            }
            if (descContains(companyName).clickable(true).exists()) {
                find = true;
                descContains(companyName).findOne().click();
                toastLog("选择公司：" + companyName);
                return;
            }
        } else {
            sleep(1000);
        }
    }
    if (!find) {
        killApp("钉钉");
        toastLog("页面卡死，尝试重新打开应用");
        tryToRestart();
    }
}

// 查询打卡结果
function queryClockInResults() {
    let page = loopWaitingForPage();
    switch (page) {
        case "restDay":
            sendNotify("休息日无需打卡");
            back();
            back();
            return;
        case "clockIn":
            break
        default:
            toastLog("当前页面并非打卡页面，无法获取结果", page);
            back();
            back();
            return;
    }

    toastLog("获取打卡结果");
    let res = ""
    if (className("android.view.View").text("上班09:00").exists()) {
        let target = className("android.view.View").text("上班09:00").findOne()
        if (target.parent().child(1).child(0).childCount() > 1) {
            res += "上班09:00 " + target.parent().child(1).child(0).child(1).text();
        } else {
            res += "上班09:00 " + target.parent().child(1).child(0).child(0).text();
        }
    }
    res += "\n"
    if (className("android.view.View").text("下班18:00").exists()) {
        let target = className("android.view.View").text("下班18:00").findOne()
        if (target.parent().child(1).child(0).childCount() > 1) {
            res += "下班18:00 " + target.parent().child(1).child(0).child(1).text();
        } else {
            res += "下班18:00 " + target.parent().child(1).child(0).child(0).text();
        }
    }
    toastLog(res);
    sendNotify(res);
    back();
    back();
}

// 退出脚本
function exitScript() {
    toastLog("脚本执行完毕，退出");
    home();
    exit();
}

// 发送通知到qq
// See: https://qmsg.zendee.cn/
function sendNotify(data) {
    if (notifyForQMsg) {
        log("发送通知： ", data);
        let url = "https://qmsg.zendee.cn/send/" + notifyForQMsg;
        http.post(url, {
            "msg": getDateTime(true) + " 打卡结果\n" + data
        });
    }
}

// 发送通知并退出脚本
function sendNotifyAndExitScript(data) {
    toastLog(data);
    sendNotify(data);
    exitScript();
}

// 获取当前时间，默认格式: 2021/09/18 14:00:00
// rule:
// 1: 格式: 2021/09/18
// 2: 格式: 2021-09-18
function getDateTime(rule) {
    let date = new Date();
    let year = date.getFullYear();
    let month = date.getMonth() + 1;
    let day = date.getDate();
    let hour = date.getHours();
    let minute = date.getMinutes();
    let second = date.getSeconds();

    if (month < 10) {
        month = "0" + month;
    }
    if (day < 10) {
        day = "0" + day;
    }
    if (hour < 10) {
        hour = "0" + hour;
    }
    if (minute < 10) {
        minute = "0" + minute
    }
    if (second < 10) {
        second = "0" + second;
    }

    switch (rule) {
        case 1:
            return year + "/" + month + "/" + day
        case 2:
            return year + "-" + month + "-" + day
        default:
            return year + "/" + month + "/" + day + " " + hour + ":" + minute + ":" + second;
    }
}

// 获取今年的所有节假日
function setHoliday() {
    toastLog("获取当年节假日数据");
    let res = http.get(holidayApi, {});
    let jsonObj = JSON.parse(res.body.string());
    if (jsonObj.code === -1) {
        toastLog("获取节假日数据失败");
        exitScript();
    }

    let holiday = jsonObj.holiday;
    let holidayArray = [];
    if (holiday) {
        for (let key in holiday) {
            if (holiday[key].holiday) {
                holidayArray.push(holiday[key].date);
            }
        }
        dingConf.put(holidayConfName, holidayArray);
    } else {
        toastLog("节假日数据接口变更，请联系开发者，并设置节假日规则为请选择或跳过周末");
        exitScript();
    }
}