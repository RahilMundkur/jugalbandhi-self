require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'CrashReportBridge'
  s.version          = package['version']
  s.summary          = package['description']
  s.license          = package['license']
  s.homepage         = 'https://example.com/'
  s.author           = package['author']
  s.source           = { :git => 'https://example.com/crash-report-bridge.git', :tag => s.version.to_s }
  s.source_files     = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  # Matches the Android side's Firebase Crashlytics + Analytics pairing —
  # see CrashReportPlugin.kt's setEnabled() for why both are toggled
  # together. Both fail soft at runtime (see CrashReportPlugin.swift) if
  # GoogleService-Info.plist hasn't been added to the app target yet, so
  # this pod is safe to keep even before that file exists.
  s.dependency 'FirebaseCrashlytics'
  s.dependency 'FirebaseAnalytics'
  s.swift_versions = ['5.5']
end
