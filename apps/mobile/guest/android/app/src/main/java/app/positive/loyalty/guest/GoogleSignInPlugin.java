package app.positive.loyalty.guest;

import android.os.CancellationSignal;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/**
 * Родной вход Google (Credential Manager) для «Карты гостя».
 *
 * Зачем свой, а не веб-кнопка: страница в приложении живёт на
 * https://localhost, Google отвечает origin_mismatch, а окно входа уходит в
 * Chrome и вернуть токен в приложение не может (22.11.2026).
 *
 * Токен выписывается на ВЕБ-клиент (serverClientId) — тот же, что у сайта,
 * поэтому сервер проверяет его без изменений (apps/api/src/identity/google-token.ts).
 * Android-клиент в Google Cloud Console (пакет app.positive.loyalty.guest +
 * SHA-1 ключа подписи) нужен только чтобы Google пустил приложение; без него
 * ответ — ошибка «Developer console is not set up correctly» (код FAILED).
 *
 * Коды отказа для веб-части: CANCELED — гость закрыл окно, молчим;
 * NO_CREDENTIAL — на телефоне нет аккаунта Google; FAILED — всё остальное.
 */
@CapacitorPlugin(name = "GoogleSignIn")
public class GoogleSignInPlugin extends Plugin {

    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("serverClientId");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("serverClientId is required", "FAILED");
            return;
        }

        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager manager = CredentialManager.create(getContext());

        manager.getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    Credential credential = result.getCredential();
                    if (credential instanceof CustomCredential
                        && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                        try {
                            GoogleIdTokenCredential google =
                                GoogleIdTokenCredential.createFrom(((CustomCredential) credential).getData());
                            JSObject ret = new JSObject();
                            ret.put("idToken", google.getIdToken());
                            call.resolve(ret);
                        } catch (Exception e) {
                            call.reject("Bad Google credential: " + e.getMessage(), "FAILED");
                        }
                        return;
                    }
                    call.reject("Unexpected credential type", "FAILED");
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    String code = "FAILED";
                    if (e instanceof GetCredentialCancellationException) {
                        code = "CANCELED";
                    } else if (e instanceof NoCredentialException) {
                        code = "NO_CREDENTIAL";
                    }
                    call.reject(String.valueOf(e.getMessage()), code);
                }
            }
        );
    }
}
