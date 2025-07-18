---
layout: post
title:  "033. Google sign in with Rails api."
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_033/google_sign_in.jpg
---
Demo đơn giản về cách login với Google trong Rails api.
#### 1.Get Google Client ID
Tới trang **Google Cloud Console**: [Get Google Client ID](https://console.cloud.google.com/apis/credentials)

Nếu chưa có Client ID nào thì **+ Create Credentials** > **Create OAuth client ID**.

Chọn **Web Application** là **Application Type**. Ở phần **Authorized JavaScript origins**, các bạn cần điền endpoint của FE, ví dụ: <mark>https://example.com</mark>.


#### 2.Rails

```sh
# Gemfile
gem 'googleauth'
```
```ruby
# frozen_string_literal: true

class AuthController < ApplicationController
  def create
    sso = Google::Auth::IDTokens.verify_oidc(params[:credential], aud: ENV.fetch('GOOGLE_CLIENT_ID', nil))
    render json: { error: "Invalid credential" }, status: 400

    user = User.find_or_initialize_by(email: sso['email'])
    user.first_name = sso['given_name']
    user.last_name = sso['family_name']
    user.last_access = Time.current
    user.save!

    access_token = {
      access_token: API::Helpers::JwtHelper.encode(
        {user: {id: user.id, email: user.email,
                first_name: user.first_name, last_name: user.last_name, status: user.status},
          exp: (Time.current + Settings.user.authenticate.access_token.expire_time.hours).to_i}
      ),
      refresh_token: API::Helpers::JwtHelper.encode(
        {user: {id: user.id},
          exp: (Time.current + Settings.user.authenticate.refresh_token.expire_time.hours).to_i}
      )
    }

    render json: access_token, status: 200
  end
end

```
#### 3.Reactjs
```sh
npm create vite@latest react-google-login  -- --template react
```
```sh
npm install @react-oauth/google
```
```js
// App.jsx
import { useState } from "react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";

function Homepage() {
  const [authData, setAuthData] = useState(null);

  return (
    <GoogleOAuthProvider clientId={"YOUR_GOOGLE_CLIENT_ID_HERE"}>
      <div>
        <GoogleLogin
          onSuccess={(credentialResponse) => {
            setAuthData(credentialResponse);
            console.log("Success!", credentialResponse);
          }}
          onError={() => {
            console.log("Login Failed");
          }}
        />
        {authData && (
          <div>
            <p>Credential: {authData.credential}</p>
            <p>Select By: {authData.select_by}</p>
          </div>
        )}
      </div>
    </GoogleOAuthProvider>
  );
}

export default Homepage;
```
```sh
npm run dev -- --port 4000
```

Có vẻ chạy cũng ổn ổn rồi đấy. Giờ thử gửi credential lên BE xem sao.

```js
import { useState } from "react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";

function Homepage() {
  const [accessToken, setAccessToken] = useState(null);

  const handleLoginSuccess = async (credentialResponse) => {
    try {
      const response = await fetch('http://localhost:3000/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          credential: credentialResponse.credential
        })
      });

      if (response.ok) {
        const data = await response.json();
        setAccessToken(data.access_token);

      } else {
        console.error('Failed to authenticate with backend');
      }
    } catch (error) {
      console.error('Error sending credential to backend:', error);
    }
  };

  return (
    <GoogleOAuthProvider clientId={"YOUR_GOOGLE_CLIENT_ID_HERE"}>
      <div>
        <GoogleLogin
          onSuccess={handleLoginSuccess}
          onError={() => {
            console.log("Login Failed");
          }}
        />
        {accessToken && (
          <div>
            <p>AccessToken: {accessToken}</p>
          </div>
        )}
      </div>
    </GoogleOAuthProvider>
  );
}

export default Homepage;
```
