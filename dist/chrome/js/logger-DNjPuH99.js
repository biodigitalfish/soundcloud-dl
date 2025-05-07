var LogLevel = /* @__PURE__ */ ((LogLevel2) => {
  LogLevel2[LogLevel2["Debug"] = 0] = "Debug";
  LogLevel2[LogLevel2["Information"] = 1] = "Information";
  LogLevel2[LogLevel2["Warning"] = 2] = "Warning";
  LogLevel2[LogLevel2["Error"] = 3] = "Error";
  LogLevel2[LogLevel2["None"] = 4] = "None";
  return LogLevel2;
})(LogLevel || {});
class Logger {
  constructor(source, minLogLevel) {
    this.source = source;
    this.minLogLevel = minLogLevel;
  }
  log(logLevel, message, ...args) {
    if (logLevel < this.minLogLevel) return;
    const timestamp = `[${(/* @__PURE__ */ new Date()).toJSON()}]`;
    const source = `[SOUNDCLOUD-DL:${this.source}]`;
    switch (logLevel) {
      case 3:
        console.error(timestamp, source, message, ...args);
        break;
      case 2:
        console.warn(timestamp, source, message, ...args);
        break;
      case 1:
        console.info(timestamp, source, message, ...args);
        break;
      case 0:
        console.debug(timestamp, source, message, ...args);
        break;
    }
  }
  logDebug(message, ...args) {
    try {
      const debugEnabled = window.localStorage.getItem("SOUNDCLOUD-DL-debugLoggingEnabled");
      if (debugEnabled !== "true") {
        return;
      }
    } catch (e) {
      console.warn("Logger: Failed to access localStorage for debug setting, disabling debug logs.", e);
      return;
    }
    this.log(0, message, ...args);
  }
  logInfo(message, ...args) {
    this.log(1, message, ...args);
  }
  logWarn(message, ...args) {
    this.log(2, message, ...args);
  }
  logError(message, ...args) {
    this.log(3, message, ...args);
  }
  static create(name, minLogLevel = 2) {
    return new Logger(name, minLogLevel);
  }
}
export {
  Logger as L,
  LogLevel as a
};
