"""Generate the dependency-free Xcode project (Python standard library only)."""
from pathlib import Path
import json
import plistlib

root = Path(__file__).resolve().parent
project = root / 'ToolboxDrawing.xcodeproj'
project.mkdir(exist_ok=True)
info = {
    'CFBundleDevelopmentRegion': 'zh_CN', 'CFBundleDisplayName': 'Toolbox 绘图本',
    'CFBundleExecutable': '$(EXECUTABLE_NAME)', 'CFBundleIdentifier': '$(PRODUCT_BUNDLE_IDENTIFIER)',
    'CFBundleInfoDictionaryVersion': '6.0', 'CFBundleName': 'ToolboxDrawing', 'CFBundlePackageType': 'APPL',
    'CFBundleShortVersionString': '0.2.0', 'CFBundleVersion': '2', 'LSRequiresIPhoneOS': True,
    'UILaunchScreen': {}, 'UISupportedInterfaceOrientations': ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
    'NSCameraUsageDescription': '仅用于扫描电脑 Toolbox 绘图配对二维码。',
    'NSLocalNetworkUsageDescription': '通过局域网与自己的电脑同步笔迹和图片。',
    'NSAppTransportSecurity': {'NSAllowsArbitraryLoads': True},
    'ITSAppUsesNonExemptEncryption': False,
    'UIFileSharingEnabled': True, 'LSSupportsOpeningDocumentsInPlace': True,
}
with (root / 'ToolboxDrawing' / 'Info.plist').open('wb') as f:
    plistlib.dump(info, f)
ids = {name: f'{i:024X}' for i, name in enumerate(['project', 'main', 'sources', 'products', 'target', 'product', 'phase', 'appref', 'storeref', 'appbuild', 'storebuild', 'projectconfigs', 'targetconfigs', 'pd', 'pr', 'td', 'tr'], 1)}
i = ids
settings = 'SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 16.0; CLANG_ENABLE_MODULES = YES; SWIFT_VERSION = 5.0;'
targetsettings = 'PRODUCT_BUNDLE_IDENTIFIER = cn.macpe.agenttoolbox.drawing; PRODUCT_NAME = ToolboxDrawing; INFOPLIST_FILE = ToolboxDrawing/Info.plist; TARGETED_DEVICE_FAMILY = 2; CODE_SIGN_STYLE = Automatic; SUPPORTS_MACCATALYST = NO; SWIFT_EMIT_LOC_STRINGS = YES;'
text = '''// !$*UTF8*$!
{archiveVersion = 1; classes = {}; objectVersion = 56; objects = {
'''
text += f'''{i['project']} = {{isa = PBXProject; attributes = {{LastUpgradeCheck = 1600;}}; buildConfigurationList = {i['projectconfigs']}; compatibilityVersion = "Xcode 14.0"; developmentRegion = zh_CN; knownRegions = (en, Base, zh_CN); mainGroup = {i['main']}; productRefGroup = {i['products']}; projectDirPath = ""; projectRoot = ""; targets = ({i['target']});}};
{i['main']} = {{isa = PBXGroup; children = ({i['sources']}, {i['products']}); sourceTree = "<group>";}};
{i['sources']} = {{isa = PBXGroup; path = ToolboxDrawing; children = ({i['appref']}, {i['storeref']}); sourceTree = "<group>";}};
{i['products']} = {{isa = PBXGroup; children = ({i['product']}); name = Products; sourceTree = "<group>";}};
{i['product']} = {{isa = PBXFileReference; explicitFileType = wrapper.application; path = ToolboxDrawing.app; sourceTree = BUILT_PRODUCTS_DIR;}};
{i['appref']} = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = App.swift; sourceTree = "<group>";}};
{i['storeref']} = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = SyncStore.swift; sourceTree = "<group>";}};
{i['appbuild']} = {{isa = PBXBuildFile; fileRef = {i['appref']};}};
{i['storebuild']} = {{isa = PBXBuildFile; fileRef = {i['storeref']};}};
{i['phase']} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({i['appbuild']}, {i['storebuild']}); runOnlyForDeploymentPostprocessing = 0;}};
{i['target']} = {{isa = PBXNativeTarget; buildConfigurationList = {i['targetconfigs']}; buildPhases = ({i['phase']}); buildRules = (); dependencies = (); name = ToolboxDrawing; productName = ToolboxDrawing; productReference = {i['product']}; productType = "com.apple.product-type.application";}};
{i['projectconfigs']} = {{isa = XCConfigurationList; buildConfigurations = ({i['pd']}, {i['pr']}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;}};
{i['targetconfigs']} = {{isa = XCConfigurationList; buildConfigurations = ({i['td']}, {i['tr']}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;}};
{i['pd']} = {{isa = XCBuildConfiguration; buildSettings = {{{settings} DEBUG_INFORMATION_FORMAT = dwarf;}}; name = Debug;}};
{i['pr']} = {{isa = XCBuildConfiguration; buildSettings = {{{settings} SWIFT_OPTIMIZATION_LEVEL = "-O";}}; name = Release;}};
{i['td']} = {{isa = XCBuildConfiguration; buildSettings = {{{targetsettings} SWIFT_OPTIMIZATION_LEVEL = "-Onone";}}; name = Debug;}};
{i['tr']} = {{isa = XCBuildConfiguration; buildSettings = {{{targetsettings}}}; name = Release;}};
}}; rootObject = {i['project']};}}
'''
(project / 'project.pbxproj').write_text(text, encoding='utf-8')
scheme = project / 'xcshareddata' / 'xcschemes'
scheme.mkdir(parents=True, exist_ok=True)
(scheme / 'ToolboxDrawing.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{i['target']}" BuildableName="ToolboxDrawing.app" BlueprintName="ToolboxDrawing" ReferencedContainer="container:ToolboxDrawing.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{i['target']}" BuildableName="ToolboxDrawing.app" BlueprintName="ToolboxDrawing" ReferencedContainer="container:ToolboxDrawing.xcodeproj"/></BuildableProductRunnable></LaunchAction><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>''', encoding='utf-8')
print('Generated ToolboxDrawing.xcodeproj; Apple signing credentials are not included.')
