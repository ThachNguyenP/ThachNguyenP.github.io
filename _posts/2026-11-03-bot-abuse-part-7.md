---
layout: post
title:  "091. Bot & Abuse protection (Click fraud & Ad fraud)."
date:   2026-11-03 01:22:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_091/bot-abuse-click-fraud.png
---
Nếu app của các bro có tính năng quảng cáo, affiliate, hay trả tiền theo lượt click, chắc chắn sẽ gặp **click fraud**: click ảo để ăn tiền, hoặc để đốt tiền quảng cáo của đối thủ.

#### Các kiểu ad fraud phổ biến
| Kiểu | Chuyện gì xảy ra |
|---|---|
| **Click fraud** | Bot hoặc "click farm" click liên tục vào quảng cáo, link affiliate |
| **Impression fraud** | Hiển thị quảng cáo ở chỗ không ai thấy (pixel 1x1, tab ẩn) để tính lượt xem |
| **Competitor clicking** | Click vào quảng cáo của đối thủ cho họ hết ngân sách |
| **Publisher fraud** | Chủ website tự click vào quảng cáo trên trang của mình để nhận tiền |
| **Attribution fraud** | Giành công cho các lượt cài app, đơn hàng mà mình không hề giới thiệu |

Bài này làm một hệ thống theo dõi click đơn giản cho quảng cáo hoặc affiliate, kèm các quy tắc lọc click không hợp lệ.

#### Nguyên tắc
- **Ghi lại tất cả** click, nhưng **chỉ tính tiền** cho click hợp lệ.
- Lúc click thì **ghi nhanh rồi redirect**, user không phải chờ. Việc phân tích để job làm sau.
- Mỗi click bị loại phải có **lý do**, để còn kiểm tra và giải thích khi có khiếu nại.

#### Impression token
Một click hợp lệ phải đến sau khi quảng cáo được **hiển thị**. Khi hiển thị quảng cáo, tạo một token có ký và có thời hạn
```ruby
# app/helpers/ads_helper.rb

module AdsHelper
  def ad_click_url(ad)
    token = Rails.application.message_verifier(:ad_impression).generate(
      { "ad_id" => ad.id, "shown_at" => Time.current.to_f },
      expires_in: 1.hour
    )
    ad_click_path(token:)
  end
end
```
Token được ký bằng <mark>secret_key_base</mark>, nên không thể làm giả. Bot gọi thẳng vào link click mà không qua bước hiển thị sẽ không có token hợp lệ.

#### Ghi nhận click
```sh
rails g model AdClick ad:references ip:string user_agent:string device_id:string shown_at:datetime valid_click:boolean invalid_reason:string
```
```ruby
# app/controllers/ad_clicks_controller.rb

class AdClicksController < ApplicationController
  def show
    data = Rails.application.message_verifier(:ad_impression).verified(params[:token])
    ad = Ad.find_by(id: data&.dig("ad_id"))
    return redirect_to root_path unless ad

    click = AdClick.create!(
      ad:,
      ip: request.remote_ip,
      user_agent: request.user_agent,
      device_id: cookies[:device_id],
      shown_at: Time.zone.at(data["shown_at"])
    )
    ValidateAdClickJob.perform_later(click.id)

    redirect_to ad.target_url, allow_other_host: true
  end
end
```
- <mark>verified</mark>: trả về <mark>nil</mark> nếu token bị sửa hoặc đã hết hạn.
- <mark>allow_other_host: true</mark>: từ Rails 7, redirect sang domain khác phải khai báo rõ ràng.

#### Quy tắc lọc click
```ruby
# app/jobs/validate_ad_click_job.rb

class ValidateAdClickJob < ApplicationJob
  def perform(click_id)
    click = AdClick.find(click_id)
    reason = invalid_reason(click)
    click.update!(valid_click: reason.nil?, invalid_reason: reason)
  end

  private

  def invalid_reason(click)
    return "bot_user_agent" if Browser.new(click.user_agent.to_s).bot?
    return "too_fast" if click.created_at - click.shown_at < 1.second
    return "duplicate" if duplicate?(click)
    return "too_many_from_ip" if too_many_from_ip?(click)
    nil
  end

  # cùng IP hoặc thiết bị đã click quảng cáo này trong 24h
  def duplicate?(click)
    AdClick.where(ad_id: click.ad_id, valid_click: true)
           .where(created_at: 24.hours.ago..)
           .where("ip = ? OR (device_id IS NOT NULL AND device_id = ?)", click.ip, click.device_id)
           .where.not(id: click.id)
           .exists?
  end

  # một IP click quá nhiều quảng cáo khác nhau trong 1 giờ
  def too_many_from_ip?(click)
    AdClick.where(ip: click.ip, created_at: 1.hour.ago..).count > 20
  end
end
```
- <mark>Browser.new(...).bot?</mark>: gem <mark>browser</mark> có sẵn danh sách user agent của bot, crawler.
- **too_fast**: người thật cần ít nhất một chút thời gian để nhìn thấy và click.
- **duplicate**: một người click 10 lần thì chỉ tính 1 lần. Đây là quy tắc quan trọng nhất.
- **too_many_from_ip**: hành vi của click farm.

Có thể thêm các quy tắc khác: IP đến từ data center (AWS, GCP...) thay vì nhà mạng, IP nằm ngoài quốc gia mà quảng cáo nhắm tới...

#### Phát hiện bất thường theo publisher
Có những gian lận không nhìn thấy được qua từng click, mà phải nhìn tổng thể. Ví dụ publisher có tỉ lệ click (CTR) cao bất thường. Giả sử chúng ta có lưu thêm lượt hiển thị trong bảng <mark>ad_impressions</mark>, và mỗi <mark>Ad</mark> thuộc về một publisher
```ruby
# CTR của từng publisher trong 7 ngày
impressions = AdImpression.joins(:ad).where(created_at: 7.days.ago..).group("ads.publisher_id").count
clicks = AdClick.joins(:ad).where(created_at: 7.days.ago.., valid_click: true).group("ads.publisher_id").count

ctr = impressions.to_h do |publisher_id, count|
  [publisher_id, clicks.fetch(publisher_id, 0).fdiv(count)]
end
# => { 1 => 0.021, 2 => 0.018, 3 => 0.35 }  publisher 3 rất đáng ngờ
```
Mỗi ngành có một mức CTR bình thường, thường chỉ vài phần trăm. Publisher nào có CTR gấp nhiều lần mức trung bình, hoặc có rất nhiều click nhưng **gần như không có đơn hàng** (conversion rate gần bằng 0), thì cần đưa vào danh sách kiểm tra.

Đây cũng là lý do nhiều hệ thống chuyển từ trả tiền theo click (**CPC**) sang trả tiền theo đơn hàng (**CPA**): click thì dễ làm giả, còn đơn hàng có thanh toán thật thì khó hơn nhiều.

#### Một vài lưu ý
- **Đừng công khai quy tắc lọc.** Nói rõ quy tắc thì kẻ gian sẽ điều chỉnh để lách qua.
- **Giữ tiền một thời gian** trước khi trả cho publisher, ví dụ 30 ngày, để có thời gian phát hiện gian lận.
- **Xem lại theo thời gian.** Click ban đầu được tính là hợp lệ, sau đó phát hiện publisher gian lận thì vẫn có thể loại lại toàn bộ click của họ.
- Nếu chỉ là **người chạy quảng cáo** trên Google, Facebook, thì các nền tảng đã tự lọc click không hợp lệ. Việc của các bro là theo dõi conversion, và loại trừ những IP, vị trí hiển thị có nhiều click mà không có chuyển đổi.
