---
layout: post
title:  "获取设备序列号 SN码（对应：设置-关于手机-状态-序列号 ）"
date:   2017-05-05 09:07
categories: Android
comments: true
description: Get android device SN
---

* content
{:toc}

## 本文

[http://afra55.github.io/2017/05/05/get_android_device_sn/](http://afra55.github.io/2017/05/05/get_android_device_sn/)

## 前情提要

我们通过 SN 码和 IMEI 码来混合确定一个唯一的 android 手机。

SN码是Serial Number的缩写，有时也叫SerialNo，也就是产品序列号，产品序列是为了验证“产品的合法身份”而引入的一个概念，它是用来保障用户的正版权益，享受合法服务的；一套正版的产品只对应一组产品序列号。别称：机器码、认证码、注册申请码等。

adb 命令获取 android SN码方式： 

	adb shell getprop gsm.serial

IMEI(International Mobile Equipment Identity)是国际移动设备身份码的缩写，国际移动装备辨识码，是由15位数字组成的"电子串号"，它与每台移动电话机一一对应，而且该码是全世界唯一的。每一只移动电话机在组装完成后都将被赋予一个全球唯一的一组号码，这个号码从生产到交付使用都将被制造生产的厂商所记录。 IMEI码由GSM（全球移动通信协会）统一分配，授权BABT（英国通信认证管理委员会）审受。

adb 获取 android imei 码：

	adb shell service call iphonesubinfo 1

	返回（右面的数字就是 imei码）：
		
		Result: Parcel(
	  		0x00000000: 00000000 0000000f 00360038 00330039 '........8.6.9.3.'
	  		0x00000010: 00300030 00320030 00380030 00310034 '0.0.0.2.0.8.4.1.'
	  		0x00000020: 00330032 00000039                   '2.3.9...        ')

## 代码获取 IMEI码：

	((TelephonyManager) getSystemService(TELEPHONY_SERVICE)).getDeviceId()；


## 代码获取 SN码：

SN 码不能直接获取，需要通过反射的方法获取。

### 反射工具类

	/**
     * 通过类对象，运行指定方法
     * @param obj 类对象
     * @param methodName 方法名
     * @param params 参数值
     * @return 失败返回null
     */
    public static Object invokeDeclaredMethod(Object obj, String methodName, Object[] params) {
        if (obj == null || TextUtils.isEmpty(methodName)) {
            return null;
        }
        Class<?> clazz = obj.getClass();
        try {
            Class<?>[] paramTypes = null;
            if (params != null) {
                paramTypes = new Class[params.length];
                for (int i = 0; i < params.length; ++i) {
                    paramTypes[i] = params[i].getClass();
                }
            }
            Method method = clazz.getDeclaredMethod(methodName, paramTypes);
            method.setAccessible(true);
            return method.invoke(obj, params);
        } catch (NoSuchMethodException e) {
            Log.i("reflect", "method " + methodName + " not found in " + obj.getClass().getName());
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }			

### 代码获取 SN 码

		try {
			String.valueOf(ReflectionUtil.invokeDeclaredMethod(new Build(), "getString", new Object[]{"gsm.serial"}));
		} catch (Exception e) {
			e.printStackTrace();
		}	

