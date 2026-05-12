#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Bridge the Swift plugin into the Capacitor Objective-C runtime so
// `Capacitor.Plugins.AudioPack` resolves at the JS layer.
CAP_PLUGIN(AudioPackPlugin, "AudioPack",
    CAP_PLUGIN_METHOD(getStatus,   CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getFileUri,  CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestPack, CAPPluginReturnPromise);
)
