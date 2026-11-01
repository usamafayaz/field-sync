package com.fieldsync.delivery

import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.fieldsync.specs.NativeDeliveryServiceSpec

class DeliveryServiceModule(context: ReactApplicationContext) : NativeDeliveryServiceSpec(context) {

  override fun getName(): String = NAME

  override fun start(text: String) {
    val intent = Intent(reactApplicationContext, DeliveryService::class.java).putExtra(DeliveryService.EXTRA_TEXT, text)
    try {
      ContextCompat.startForegroundService(reactApplicationContext, intent)
    } catch (e: Exception) {
      // Android 12+ refuses to start a foreground service from the background.
      Log.w(NAME, "could not start delivery service: ${e.message}")
    }
  }

  override fun stop() {
    reactApplicationContext.stopService(Intent(reactApplicationContext, DeliveryService::class.java))
  }

  companion object {
    const val NAME = "DeliveryService"
  }
}
