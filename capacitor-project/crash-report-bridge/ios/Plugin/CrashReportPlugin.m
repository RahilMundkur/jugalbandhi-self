#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Bridge the Swift plugin into the Capacitor Objective-C runtime so
// `Capacitor.Plugins.CrashReport` resolves at the JS layer.
CAP_PLUGIN(CrashReportPlugin, "CrashReport",
    CAP_PLUGIN_METHOD(logMessage,  CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(recordError, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setEnabled,  CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(isAvailable, CAPPluginReturnPromise);
)
