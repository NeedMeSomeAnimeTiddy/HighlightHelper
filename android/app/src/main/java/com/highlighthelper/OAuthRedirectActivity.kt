package com.highlighthelper

import android.app.Activity
import android.os.Bundle
import com.highlighthelper.engine.OAuthService

/**
 * Where the browser lands at the end of a sign-in.
 *
 * The Custom Tab is a different app, so the authorization code cannot come back
 * as an Activity result — it arrives as a fresh Intent on the app link
 * registered in the manifest. This Activity exists only to hand that URI to
 * whichever sign-in is waiting and get out of the way; it draws nothing and
 * finishes immediately, so the user is returned to the settings screen they
 * started from rather than to a blank page.
 *
 * `singleTask` in the manifest is what makes the return land here rather than
 * stacking a second copy of the app on top of the first.
 */
class OAuthRedirectActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle()
    }

    override fun onNewIntent(intent: android.content.Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle()
    }

    private fun handle() {
        intent?.data?.let { OAuthService.deliver(it) }
        // No result and no message either way. A sign-in that nothing was
        // waiting for is a stale link opened by hand, and the honest response
        // to that is to do nothing at all rather than to appear to succeed.
        finish()
    }
}
