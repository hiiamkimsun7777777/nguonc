# NguồnC → Stremio Addon

Project Node.js cho API được mô tả tại <https://phim.nguonc.com/api-document>.

## Chức năng

- Catalog **Phim lẻ** từ `/api/films/danh-sach/phim-le`.
- Catalog **Phim bộ** từ `/api/films/danh-sach/phim-bo`.
- Tìm kiếm từ `/api/films/search` và xác định loại phim bằng `/api/film/{slug}`.
- Metadata, thể loại, quốc gia và tập phim từ `/api/film/{slug}`.
- Dùng URL video trực tiếp nếu API cung cấp. Nếu chỉ có `embed`, Stremio mở trang phát trong trình duyệt qua `externalUrl`. Addon không trích xuất video từ trang embed.

## Upload lên GitHub

Giải nén ZIP, sau đó upload **các file bên trong thư mục này** vào thư mục gốc của repository. Trên GitHub, `server.js`, `package.json` và `render.yaml` phải nằm ngay ở cấp đầu tiên, không nằm trong thư mục con. Commit changes.

Nếu repository đã có bản cũ, thay các file cùng tên. Phiên bản manifest mới là `2.0.0` và tên catalog mới là `nguonc_movies`, `nguonc_series`; sau khi Render deploy xong, gỡ addon cũ trong Stremio rồi cài lại bằng `https://<ten-dich-vu>.onrender.com/manifest.json`.

## Render

Tạo **Web Service**, chọn repository, Language **Node**, Build Command `npm install`, Start Command `npm start`. `render.yaml` chỉ tự áp dụng khi tạo **Blueprint**; dịch vụ Web Service đã tạo thủ công vẫn dùng cấu hình trong Render Dashboard.

Kiểm tra sau khi deploy:

- `https://<ten-dich-vu>.onrender.com/manifest.json` phải hiện `"version":"2.0.0"`.
- `https://<ten-dich-vu>.onrender.com/catalog/movie/nguonc_movies.json` phải có `metas`.
- `https://<ten-dich-vu>.onrender.com/catalog/series/nguonc_series.json` phải có `metas`.

## Lỗi HTTP 403 từ NguồnC trên Render

Log của dịch vụ Render trước đó cho thấy NguồnC trả **HTTP 403** cho cả `/api/films/danh-sach/phim-le` và `/api/films/danh-sach/phim-bo`. Đây là phản hồi từ máy chủ NguồnC tới máy chủ Render; addon không thể tự sửa quyền truy cập đó. Bản mã mới báo lỗi rõ trong Render Logs thay vì trả catalog rỗng.

Trước khi chọn nơi chạy khác, kiểm tra từ chính nơi đó bằng `npm run check:api`. Cả bốn lệnh phải trả HTTP 200. Nếu Render vẫn nhận 403, hãy hỏi bên NguồnC về quyền truy cập từ Render hoặc dùng một nơi chạy được NguồnC cho phép.

## Chạy tại máy

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm run check:api
npm start
```

Manifest tại `http://localhost:7000/manifest.json`. Để cài trên thiết bị khác, addon cần một URL HTTPS công khai.
