# Test cases

Source of `docs/testing/test-catalog.{csv,json}` (run `npm run catalog`). Levels: [U] offline unit, [I] integration on a local page, [S] real staging backend, [R] read-only backend. Status per case lives in `results.json`.


### Phase 0 — Spike
| Mã | Test case | Kỳ vọng |
|---|---|---|
| P0-T01..T08 [I/R] | S1–S8 ở mục 8 | Mỗi spike có ghi chú quyết định bằng chữ |
| P0-K01 [U] | Dựng baseline test tay từ transcript của một phiên test thủ công | Bảng theo bước: số lần gọi, token đọc, token ảnh |
| P0-K02 [U] | Hiệu chuẩn tokenizer bằng `usage` thật | Sai số ghi rõ; hệ số chốt |
| P0-K03 [I] | Đo log engine thô 12 giây | Số dòng/token; căn cứ mức lọc |
| P0-K04 [U] | Đo kích thước mô tả+schema của 6 tool | Số cố định; đặt ngưỡng trần |
| P0-K05 [U] | Chốt ngưỡng ở mục 9 từ số đo thật | Bảng ngưỡng cập nhật |

### Phase 1 — Nền tảng an toàn
| Mã | Test case | Kỳ vọng |
|---|---|---|
| P1-T01 [U] | Che `?token=`, `Bearer`, bí mật đã đăng ký | Không còn giá trị bí mật |
| P1-T02 [U] | Lỗi chứa URL token | Thông báo đã che |
| P1-T03 [U] | Ghi staging mà không qua `propose/apply` | Từ chối `WRITE_GUARD`, exit 1, không mở browser |
| P1-T04 [U] | `apply` với hash sai/hết hạn | Từ chối; cờ `approved` của client không có hiệu lực |
| P1-T05 [U] | Scenario chưa hỗ trợ | `unsupported`, exit 2, không giả pass |
| P1-T06 [I] | `doctor` khi thiếu token / cổng bị chiếm / cache lệch / VPN tắt | Mỗi lỗi một dòng kèm cách sửa |
| P1-T07 [U] | Hai run cùng user | Run thứ hai bị từ chối `BUSY` |
| P1-T08 [U] | Quét toàn bộ artifact của run mẫu bằng token giả | Không có token ở đâu |
| P1-T09 [U] | Registry: capability thiếu trường bắt buộc | Từ chối nạp, nêu trường |
| P1-K01 [I] | `doctor` đạt | ≤ 250 token, 1 lần gọi |
| P1-K02 [I] | `doctor` khi 3 lỗi cùng lúc | 1 lần gọi báo đủ; so baseline dò từng lỗi |
| P1-K03 [U] | Thông báo lỗi | ≤ 60 token mỗi lỗi, không stack |
| P1-K04 [U] | Phản hồi vượt ngân sách | Bị cắt, `truncated=true`, có `resultRef` |

### Phase 2 — Browser và recorder
| Mã | Test case | Kỳ vọng |
|---|---|---|
| P2-T01 [I] | Mở preview, chờ scene | `scene-ready` theo tín hiệu, không sleep cố định |
| P2-T02 [I] | Reload giữa run | Dữ liệu trước và sau reload cùng nằm trong evidence; `seq` liên tục |
| P2-T03 [I] | Ghi console, lỗi page, request thất bại, websocket | Có bản ghi đã che |
| P2-T04 [I] | Lọc nhiễu `server.jsonl` | Không có asset tĩnh; số dòng dưới ngưỡng P0-K03 |
| P2-T05 [I] | Đóng browser đột ngột | Artifact đã ghi còn đọc được; run đánh dấu `indeterminate/aborted` |
| P2-T06 [I] | Không cướp focus | Không cửa sổ nào được đưa lên trước |
| P2-T07 [I] | Hai lần mở liên tiếp | Không rò tiến trình Chrome |
| P2-T08 [U] | Cursor/`ifRevision`/hết hạn evidence | `unchanged`, `CURSOR_MISMATCH`, `SNAPSHOT_EXPIRED` đúng |
| P2-K01 [I] | Mở preview và chờ scene | 1 lần gọi, ≤ 120 token; so baseline |
| P2-K02 [I] | Reload và ghi tiếp | Token độc lập với số bản ghi |
| P2-K03 [I] | Đọc lại cùng evidence không đổi | `unchanged`, vài token |

### Phase 3 — Bằng chứng UI và frame
| Mã | Test case | Kỳ vọng |
|---|---|---|
| P3-T01 [I] | Screenshot tại checkpoint | PNG + meta; phản hồi chỉ đường dẫn |
| P3-T02 [I] | Sampler/observer với watchlist | Chỉ ghi thay đổi |
| P3-T03 [I] | Đọc Spine `animation@timeScale` | Khớp giá trị đọc trực tiếp |
| P3-T04 [I] | Chụp `burst` quanh event | Đủ frame, chỉ số khớp dữ liệu UI |
| P3-T05 [I] | Vượt ngân sách frame | `capped=true`, không bỏ im lặng |
| P3-T06 [U] | Diff frame có node chớp (fixture) | Đúng frame và vùng |
| P3-T07 [U] | So baseline có vùng bỏ qua | Pass/fail đúng |
| P3-T08 [I] | Overhead chụp frame | FPS giảm không quá ngưỡng P0 |
| P3-K01 [I] | Chụp ảnh/frame | 0 ảnh trong phản hồi; token độc lập số frame |
| P3-K02 [I] | Chờ trạng thái X bằng điều kiện thay vì ảnh lặp | 1 lần gọi, 0 ảnh; so baseline dùng ảnh |
| P3-K03 [U] | Chi phí khi chủ động xem một ảnh | Đúng công thức ảnh; có thu nhỏ/cắt vùng |

### Phase 4 — Assertion mức base (data và logic)
| Mã | Test case | Kỳ vọng |
|---|---|---|
| P4-T01 [U] | Đếm listener theo emit từ log mẫu | Nhóm đúng; phát hiện context trùng |
| P4-T02 [U] | Assertion trình tự, `any-order`, `within`, `never` | Đúng với chuỗi mẫu |
| P4-T03 [U] | Gọi đôi request trong cửa sổ | Báo kèm nơi gọi |
| P4-T04 [U] | Command treo, `unhandledrejection` | Báo tên và ghi vào evidence |
| P4-T05 [U] | Tiền thập phân, chênh lệch ví | `0.1+0.2` đúng; fail kèm số |
| P4-T06 [U] | Validate schema, bất biến | Báo đường dẫn trường; phát hiện mode xung đột |
| P4-T07 [I] | Bộ mức base trên game không có profile | Phần cần profile báo `skipped`, không `pass` |
| P4-T08 [U] | `diff` hai evidence | Chỉ trả phần khác biệt |
| P4-K01 [U] | Kết quả assertion pass/fail | Pass: 1 dòng; fail ≤ 150 token kèm `seq`/frame/đường dẫn |
| P4-K02 [U] | `diff` hai run | Token ≈ độ lớn khác biệt, không theo kích thước hai run |
| P4-K03 [I] | Bộ mức base một game | Trong ngưỡng, 1 lần gọi |

### Phase 5 — Scenarios on a real game
| Mã | Test case | Kỳ vọng |
|---|---|---|
| P5-T01 [S] | `free-flow` | Tooltip, label, chênh lệch ví khớp server |
| P5-T02 [S] | `mode-transition`: mỗi lượt của mode phụ | Mỗi lượt đúng 1 request lượt; đúng 1 lần chuyển mode |
| P5-T03 [S] | `resume`: reload giữa một mode phụ | Đúng 1 bước chuẩn bị resume và 1 lần resume; UI khôi phục |
| P5-T04 [S] | `resume-bonus` khi session còn / đã đóng | Kết quả thật / `unstable` exit 2, giữ artifact |
| P5-T05 [S] | `jackpot` | Đúng thứ tự cutscene; tổng khớp |
| P5-T06 [I] | `event-duplicates` sau khi vào Free/Bonus | Khớp danh sách trùng đã biết |
| P5-T07 [S] | Thanh tiến trình sau resume | Xác nhận hoặc bác bỏ việc animation kẹt `timeScale = 0` |
| P5-T08 [S] | Hiệu ứng animation sau khi bỏ Promise thừa khỏi hàm phát animation | Đúng thời điểm, không chớp |
| P5-T09 [S] | Ghi staging bị gián đoạn giữa chừng | `indeterminate`, không tự replay, `reconcile` hoạt động |
| P5-T10 [S] | Lặp mỗi scenario N=5 lần | Báo tỉ lệ pass; chỉ scenario đạt ngưỡng mới là gate |
| P5-K01 [S] | Token mỗi scenario | Trong ngưỡng; có `tokens.json` |
| P5-K02 [S] | **So sánh với test tay** (baseline P0-K01) | Tỉ lệ theo từng bước; nêu khoảng cách nếu chưa đạt |
| P5-K03 [S] | Lặp 5 lần | Token mỗi lần ổn định, không tăng |
| P5-K04 [S] | Lỗi tiêm có chủ đích | Chi phí tìm nguyên nhân ≤ ngưỡng |
| P5-T11 [U] | Cheat: lập kế hoạch kiểm tra preset, môi trường và file token, không ghi backend | Preset lạ, môi trường không cho phép, thiếu token đều bị từ chối; kế hoạch không chứa token |
| P5-T12 [U] | Cheat: chưa có phê duyệt thì không gửi gì | Từ chối `WRITE_GUARD`; 0 request tới server |
| P5-T13 [U] | Cheat: một lần gửi đã duyệt là đúng một POST đúng hình dạng, không credentials | Đúng đường dẫn, content-type, các trường; không Authorization, Cookie, Origin |
| P5-T14 [U] | Cheat: phê duyệt chỉ dùng một lần | Lần hai bị từ chối, không thêm request |
| P5-T15 [U] | Cheat: Clear Session là kế hoạch và POST riêng | Đúng đường dẫn và query; kế hoạch cảnh báo mất session |
| P5-T16 [U] | Cheat: token không lộ ở bất cứ đâu dù server echo lại | Không có trong phản hồi, ledger, kế hoạch, phê duyệt |
| P5-T17 [U] | Cheat: kết quả không rõ là `indeterminate`, không retry, không theo redirect; lỗi server là `error` | Một lần thử; redirect không được theo |
| P5-T18 [U] | Cheat: quy tắc profile và URL | Chỉ https hoặc loopback, không credentials, segment an toàn, mặc định chỉ staging |
| P5-K05 [U] | Cheat: phản hồi `plan` trong ngân sách | ≤ 320 token với request id UUID, đích dạng thật |
| P5-K06 [U] | Cheat: một lần cheat là 2 lần gọi, phản hồi `apply` nhỏ | ≤ 140 token |

### Phase 6 — Mở rộng ra nhiều game
| Mã | Test case | Kỳ vọng |
|---|---|---|
| P6-T01 [U] | Validate profile | Lỗi nêu đúng trường |
| P6-T02 [I] | Game thứ hai chỉ bằng profile | Bộ mức base chạy, không sửa lõi |
| P6-T03 [S] | `run-all` trên các game có profile | Bảng game × kiểm tra × trạng thái, chạy tuần tự |
| P6-T04 [I] | Lỗi giả lập ở `cc-common` | Hiện cùng lỗi trên nhiều game, gộp một mục |
| P6-T05 [I] | Game không có profile | `skipped` kèm lý do |
| P6-K01 [I] | Chi phí thêm game | Đo token viết profile; so viết test tay mới |
| P6-K02 [S] | `run-all` N game | Token gần tuyến tính, hệ số nhỏ; bảng ≤ ngưỡng |

### Phase 7 — Ổn định và vận hành
| Mã | Test case | Kỳ vọng |
|---|---|---|
| P7-T01 [S] | Chạy mỗi scenario 20 lần | Có tỉ lệ flaky; chốt ngưỡng gate |
| P7-T02 [U] | Mã thoát 0/1/2, summary dưới 40 dòng | Đúng |
| P7-T03 [U] | Dọn evidence cũ | Giữ N run gần nhất, không xoá run đang chạy |
| P7-T04 [I] | Nâng cấp Cocos hoặc `cc-common` | Bộ mức base vẫn chạy; thay đổi phá vỡ bị phát hiện |
| P7-K01 [S] | **Đo tổng thể trước/sau** trên cùng bộ kịch bản | Báo cáo cuối: token, số lần gọi, ảnh, thời gian, tỉ lệ thành công |
| P7-K02 [U] | Hồi quy token khi thêm tool/đổi định dạng | Fail nếu vượt ngưỡng |
| P7-K03 [U] | Run vượt ngân sách | `budgetExceeded` kèm capability gây ra |
| P7-K04 [I] | Có skill vs không skill | Giữ skill chỉ khi giảm gọi hoặc token |
| P7-K05 [U] | Tổng mô tả skill | Dưới ngân sách; một test thường nạp ≤ 2 skill |

### Phase 8 — Service nền và bảng điều khiển (yêu cầu bổ sung)
| Mã | Test case | Kỳ vọng |
|---|---|---|
| P8-T01 [U] | Daemon khởi động, ghi `endpoint.json` (quyền 0600), từ chối khi không có token | 403 với Host/Origin/token sai |
| P8-T02 [U] | CLI và MCP gọi qua daemon | Cùng kết quả với engine trực tiếp (so sánh trên bộ lệnh mẫu) |
| P8-T03 [U] | Hai khởi động daemon liên tiếp | Lần hai không tranh cổng, báo đang chạy |
| P8-T04 [I] | Start/stop/status theo kiểu sở hữu | Chỉ dừng đúng tiến trình đã khởi động; không kill PID lạ |
| P8-T05 [I] | Controller phục vụ bảng điều khiển khi daemon tắt | Trang mở được, trạng thái "đã tắt", nút Bật hoạt động |
| P8-T06 [I] | Thẻ Môi trường khớp `gameplay.doctor` | Cùng số dòng và cùng cách sửa |
| P8-T07 [I] | Thẻ Run gần đây và Token khớp artifact và `ledger.jsonl` | Số liệu trùng với file |
| P8-T08 [I] | Nút Duyệt tạo đúng một phê duyệt cho đúng hash | Phê duyệt dùng một lần, hết hạn, gắn với kế hoạch |
| P8-T09 [I] | Gọi API duyệt thiếu mã duyệt / sai Origin / sai Host | Từ chối, không tạo phê duyệt |
| P8-T10 [U] | `service plan` | In nội dung sẽ cài, không ghi gì vào hệ thống |
| P8-T11 [I] | Token không xuất hiện trong HTML, JSON, log của bảng điều khiển | Quét toàn bộ, không còn token |
| P8-T12 [I] | Ảnh chụp bảng điều khiển bằng chính `gameplay.screenshot` | Có đủ 6 thẻ, nhãn tiếng Việt, không tràn ở 720 px |
| P8-K01 [I] | Gọi qua daemon so với dựng engine mỗi lần | Độ trễ và token của cuộc gọi lặp lại giảm; ghi số đo |
| P8-K02 [I] | Bảng điều khiển đang mở và polling | 0 token của agent; tải CPU của daemon dưới ngưỡng |
| P8-K03 [U] | Thêm client MCP mỏng | Số tool và kích thước schema không đổi so với hiện tại (6 tool) |
