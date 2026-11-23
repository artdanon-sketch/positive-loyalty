package app.positive.loyalty.guest;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Свой модуль регистрируется ДО super.onCreate: мост собирает список
        // модулей при создании, и зарегистрированный позже веб-часть не увидит.
        registerPlugin(GoogleSignInPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
