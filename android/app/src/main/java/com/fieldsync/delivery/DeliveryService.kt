package com.fieldsync.delivery

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Keeps delivery running when the app is in the background. */
class DeliveryService : HeadlessJsTaskService() {

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Sending reports"
    ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification(this, text),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
    )
    if (taskRunning) return START_NOT_STICKY // already running: this call only refreshed the text
    taskRunning = true
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
      HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true)

  /** Android 15 caps dataSync services at 6 h/day. Stop cleanly; work resumes when the app opens. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  override fun onDestroy() {
    taskRunning = false
    super.onDestroy()
  }

  companion object {
    const val TASK_KEY = "FieldSyncDelivery"
    const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "delivery"
    private const val NOTIFICATION_ID = 4101

    @Volatile private var taskRunning = false

    fun buildNotification(context: Context, text: String): Notification {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Report delivery", NotificationManager.IMPORTANCE_LOW).apply {
              description = "Shows while reports are waiting to reach the server"
              setShowBadge(false)
            })
      }
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val contentIntent =
          PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      return NotificationCompat.Builder(context, CHANNEL_ID)
          .setSmallIcon(android.R.drawable.stat_sys_upload)
          .setContentTitle("FieldSync")
          .setContentText(text)
          .setContentIntent(contentIntent)
          .setOngoing(true)
          .setOnlyAlertOnce(true)
          .setCategory(NotificationCompat.CATEGORY_PROGRESS)
          .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
          .build()
    }
  }
}
