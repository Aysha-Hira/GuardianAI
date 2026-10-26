from __future__ import annotations

import torch
import torch.nn as nn


class ConvLSTMCell(nn.Module):

    def __init__(self, in_channels: int, hidden_channels: int, kernel_size: int = 3) -> None:
        super().__init__()
        padding = kernel_size // 2
        self.hidden_channels = hidden_channels
        self.conv = nn.Conv2d(
            in_channels + hidden_channels,
            4 * hidden_channels,
            kernel_size,
            padding=padding,
        )

    def forward(
        self,
        x: torch.Tensor,
        state: tuple[torch.Tensor, torch.Tensor] | None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        if state is None:
            b, _, h, w = x.shape
            device = x.device
            h_t = torch.zeros(b, self.hidden_channels, h, w, device=device)
            c_t = torch.zeros(b, self.hidden_channels, h, w, device=device)
        else:
            h_t, c_t = state

        combined = torch.cat([x, h_t], dim=1)
        gates = self.conv(combined)
        i, f, o, g = torch.chunk(gates, 4, dim=1)
        i = torch.sigmoid(i)
        f = torch.sigmoid(f)
        o = torch.sigmoid(o)
        g = torch.tanh(g)
        c_next = f * c_t + i * g
        h_next = o * torch.tanh(c_next)
        return h_next, c_next


class ConvLSTMAutoencoder(nn.Module):

    def __init__(
        self,
        seq_len: int = 12,
        img_size: int = 128,
        hidden_channels: int = 32,
    ) -> None:
        super().__init__()
        self.seq_len = seq_len
        self.img_size = img_size
        self.hidden_channels = hidden_channels

        self.encoder = nn.Sequential(
            nn.Conv2d(1, 16, 3, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(16, 32, 3, stride=2, padding=1),
            nn.ReLU(inplace=True),
        )
        self.enc_size = img_size // 4
        self.conv_lstm = ConvLSTMCell(32, hidden_channels, kernel_size=3)
        self.decoder = nn.Sequential(
            nn.ConvTranspose2d(hidden_channels, 32, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(32, 16, 4, stride=2, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(16, 1, 3, padding=1),
            nn.Sigmoid(),
        )

    def encode_sequence(self, x: torch.Tensor) -> torch.Tensor:
        b, t, _, _, _ = x.shape
        state: tuple[torch.Tensor, torch.Tensor] | None = None
        last_h: torch.Tensor | None = None
        for i in range(t):
            frame = x[:, i]
            enc = self.encoder(frame)
            h, c = self.conv_lstm(enc, state)
            state = (h, c)
            last_h = h
        assert last_h is not None
        return last_h

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.encode_sequence(x)
        b, t = x.shape[0], x.shape[1]
        recon = []
        for _ in range(t):
            recon.append(self.decoder(h))
        return torch.stack(recon, dim=1)

    @torch.no_grad()
    def reconstruction_error(self, x: torch.Tensor) -> torch.Tensor:
        self.eval()
        pred = self.forward(x)
        return torch.mean((pred - x) ** 2, dim=(1, 2, 3, 4))
