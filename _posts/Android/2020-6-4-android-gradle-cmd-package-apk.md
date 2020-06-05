---
layout: post
title:  "命令行打包 Android APK"
date:   2020-6-4 10:00
categories: Android
comments: true
description: 命令行打包 Android APK
---

* content
{:toc}

## 注意
版本的不同，安装目录也会有所变化。
## 安装软件包管理器
### MAC 电脑
Iterm 中安装 Homebrew:
[https://brew.sh/index_zh-cn](https://brew.sh/index_zh-cn)
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install.sh)"

```

### Windows 电脑
安装 Choco:
[https://chocolatey.org/docs/installation#non-administrative-install](https://chocolatey.org/docs/installation#non-administrative-install)

#### cmd.exe 中安装
```
@"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -InputFormat None -ExecutionPolicy Bypass -Command " [System.Net.ServicePointManager]::SecurityProtocol = 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))" && SET "PATH=%PATH%;%ALLUSERSPROFILE%\chocolatey\bin"
```

#### PowerShell.exe 中安装
```
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
```

## 安装 JDK8

### Mac os
```
brew tap adoptopenjdk/openjdk
brew cask install adoptopenjdk8
```

### Windows
```
choco install jdk8
```

## 安装 Gradle

### Mac os
```
brew install gradle
```
安装路径：`/usr/local/Cellar/gradle/5.0/bin`
### Windows
```
choco install gradle
```
安装路径：`C:\ProgramData\chocolatey\lib-bkp\gradle\tools\gradle-6.3\bin`

## 安装 Android SDK
这里会提示安装 jdk，可以跳过安装jkd。
### Mac os
```
brew cask install android-sdk
```
安装路径：`/usr/local/Caskroom/android-sdk`

### Windows 
```
choco install android-sdk
```
安装路径：`C:\Android\android-sdk`
## 安装 androd build-tools
windows sdkmanager 在路径 `C:\Android\android-sdk\tools\bin` 中。
mac sdkmanager 在路径 `/usr/local/Caskroom/android-sdk/4333796/tools` 中。
```
sdkmanager "platforms;android-28"
```
或指定详细版本：
```
sdkmanager "build-tools;29.0.1"
```

Windows 安装路径：`C:\Android\android-sdk\build-tools\29.0.1`
Mac 安装路径： `/usr/local/Caskroom/android-sdk/4333796/build-tools/29.0.1`

## 构建调试 APK

在此之前你需要修改 `local.properties` 文件中的 sdk 路径。

请打开命令行，然后转到项目的根目录：
```
gradlew assembleDebug
```

将在 project_name/module_name/build/outputs/apk/ 中创建一个名为 module_name-debug.apk 的 APK。 该文件已使用调试密钥进行签名并使用 zipalign 对齐，因此您可以立即将其安装到设备上。

构建 APK 并立即在运行的模拟器或连接的设备上安装:
```
gradlew installDebug
```

## 构建发布版本 APK

在此之前你需要修改 `local.properties` 文件中的 sdk 路径。

### 生层私钥
```
    keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-alias
    
```
生成一个名为 my-release-key.jks 的密钥库文件，并将其保存在当前目录中。

### 配置Gradle来构建应用 

```
android {
        ...
        defaultConfig { ... }
        signingConfigs {
            release {
           
                // You need to specify either an absolute path or include the
                // keystore file in the same directory as the build.gradle file.
                storeFile file("my-release-key.jks")
                storePassword "password"
                keyAlias "my-alias"
                keyPassword "password"
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.release
                debuggable false
                zipAlignEnabled true
                shrinkResources true
                minifyEnabled true
                ...
            }
        }
    }
    
```

构建 apk：
```
gradlew assembleRelease
```
当您通过调用 Gradle 任务来构建您的应用时，Gradle 会为您的应用签名（并运行 zipalign）。

### 不使用 Gradle 配置使用命令行
下面使用的 `zipalign` `apksigner` 在 build-tools 目录下。
#### 构建未签名的 apk
```
gradlew assembleRelease
```
#### 使用 zipalign 对齐未签名的 APK
```
    zipalign -v -p 4 my-app-unsigned.apk my-app-unsigned-aligned.apk
    
```
zipalign 可以确保所有未压缩数据的开头均相对于文件开头执行特定的字节对齐，从而减少应用占用的 RAM 量。
#### 通过 apksigner 使用您的私钥为 APK 签名
```
    apksigner sign --ks my-release-key.jks --out my-app-release.apk my-app-unsigned-aligned.apk
    
```
用存储在单个密钥库文件 my-release-key.jks 中的私钥和证书为 APK 签名后，将以 my-app-release.apk 的形式输出已签名的 APK。
#### 验证签名
```
 apksigner verify my-app-release.apk
```

## 环境变量的配置
### Mac
在 `~/.bash_profile`(如果使用iterm则是`~/.zshrc`)文件中添加:
```
export ANDROID_HOME=/usr/local/Caskroom/android-sdk
export PATH=$PATH:$ANDROID_HOME/4333796/tools
export PATH=$PATH:$ANDROID_HOME/4333796/build-tools/29.0.1

export GRADLE_HOME=/usr/local/Cellar/gradle
export PATH=$GRADLE_HOME/5.0/bin
```

### Windows
```
C:\Android\android-sdk\tools\bin
C:\Android\android-sdk\build-tools\29.0.1
C:\ProgramData\chocolatey\lib-bkp\gradle\tools\gradle-6.3\bin
```

## 查看 APK 签名命令
```
keytool -list -printcert -jarfile app-relase-.apk
```
